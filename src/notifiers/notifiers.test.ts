import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { defaultConfig, type Config, type NotifierConfig } from "../config/schema.ts";
import type { AppEvent, Notification } from "../events.ts";
import { freshState } from "../state/schema.ts";
import { notificationText, notificationTitle } from "./format.ts";
import { markReported, updateNotifierHealth } from "./health.ts";
import { dispatch, sendWith } from "./index.ts";

const plan = { planCode: "vps-2027-model2", invoiceName: "VPS-2 2027", vCore: 4, ramGb: 8, price: "€8.49 + VAT (€10.36)" };
const available: AppEvent = {
  kind: "stock",
  status: "available",
  plan,
  datacenter: { code: "EU-SOUTH-MIL", label: "Milano (IT)" },
  os: "linux",
};
const withdrawn: AppEvent = { kind: "orderability", orderable: false, plan };
const notification = (events: AppEvent[], test = false): Notification => ({
  events,
  subsidiary: "IT",
  orderUrl: "https://www.ovhcloud.com/it/vps/",
  test,
});

describe("format", () => {
  it("titles a single event", () => {
    assert.equal(notificationTitle(notification([available])), "🟢 VPS-2 2027 available in Milano (IT)");
    assert.equal(notificationTitle(notification([available], true)), "[TEST] 🟢 VPS-2 2027 available in Milano (IT)");
  });

  it("titles several events after the most important one", () => {
    assert.equal(notificationTitle(notification([available, withdrawn])), "⚠️ OVH VPS: 2 changes");
  });

  it("lists events with the order link", () => {
    assert.equal(
      notificationText(notification([available])),
      "🟢 VPS-2 2027 (4 vCore, 8 GB, €8.49 + VAT (€10.36)) available in Milano (IT) (Linux)\n" +
        "Order: https://www.ovhcloud.com/it/vps/",
    );
  });

  it("truncates to the given length", () => {
    const text = notificationText(notification(Array(100).fill(available)), 1000);
    assert.ok(text.length <= 1000);
    assert.match(text, /…and \d+ more\nOrder:/);
  });
});

describe("updateNotifierHealth", () => {
  const config: Config = {
    ...defaultConfig(),
    notifiers: [
      { id: "a", name: "Telegram", enabled: true, type: "telegram", botToken: "t", chatId: "1" },
      { id: "b", name: "ntfy", enabled: true, type: "ntfy", serverUrl: "https://ntfy.sh", topic: "x", priority: 3 },
    ],
  };
  const now = new Date();

  it("reports a failure once, and the recovery", () => {
    const state = freshState("1.0.0", now);
    const failed = { attempted: 2, delivered: ["b"], failures: [{ id: "a", name: "Telegram", error: "HTTP 401" }] };
    const events = updateNotifierHealth(state, config, failed, now);
    assert.deepEqual(events, [{ kind: "notifier", id: "a", name: "Telegram", failing: true, error: "HTTP 401" }]);
    markReported(state, events);
    assert.deepEqual(updateNotifierHealth(state, config, failed, now), []);
    const ok = { attempted: 2, delivered: ["a", "b"], failures: [] };
    assert.deepEqual(updateNotifierHealth(state, config, ok, now), [{ kind: "notifier", id: "a", name: "Telegram", failing: false }]);
    assert.deepEqual(state.failingNotifiers, {});
  });
});

describe("senders", () => {
  const requests: { method: string; url: string; headers: IncomingHttpHeaders; body: any }[] = [];
  let base = "";
  let status = 200;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ method: req.method!, url: req.url!, headers: req.headers, body: JSON.parse(body) });
      res.writeHead(status).end(status === 200 ? "{}" : '{"message":"unauthorized"}');
    });
  });
  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());

  const send = async (notifier: NotifierConfig, events: AppEvent[] = [available]) => {
    requests.length = 0;
    await sendWith(notifier, notification(events));
    return requests[0]!;
  };
  const common = { id: "x", name: "x", enabled: true };

  it("discord: one embed per event, at most 10", async () => {
    const req = await send({ ...common, type: "discord", webhookUrl: `${base}/hook` });
    assert.equal(req.body.embeds[0].title, "🟢 VPS-2 2027 available");
    assert.equal(req.body.embeds[0].fields[0].value, "Milano (IT)");
    const many = await send({ ...common, type: "discord", webhookUrl: `${base}/hook` }, Array(15).fill(available));
    assert.equal(many.body.embeds.length, 10);
    assert.equal(many.body.embeds[9].title, "…and 6 more");
  });

  it("webhook: method, headers and raw events", async () => {
    const req = await send({ ...common, type: "webhook", url: `${base}/w`, method: "PUT", headers: { "X-Key": "k" } });
    assert.equal(req.method, "PUT");
    assert.equal(req.headers["x-key"], "k");
    assert.equal(req.body.events[0].plan.planCode, "vps-2027-model2");
    assert.match(req.body.events[0].message, /available in Milano/);
  });

  it("gotify: token header and click url", async () => {
    const req = await send({ ...common, type: "gotify", serverUrl: `${base}/gotify`, token: "tok", priority: 8 });
    assert.equal(req.url, "/gotify/message");
    assert.equal(req.headers["x-gotify-key"], "tok");
    assert.equal(req.body.priority, 8);
    assert.equal(req.body.extras["client::notification"].click.url, "https://www.ovhcloud.com/it/vps/");
  });

  it("ntfy: JSON publishing with bearer token", async () => {
    const req = await send({ ...common, type: "ntfy", serverUrl: base, topic: "ovh", token: "tk", priority: 4 });
    assert.equal(req.url, "/");
    assert.equal(req.body.topic, "ovh");
    assert.equal(req.headers.authorization, "Bearer tk");
  });

  it("dispatch: reports failures without stopping the others", async () => {
    status = 401;
    const config: Config = {
      ...defaultConfig(),
      notifiers: [
        { ...common, id: "a", name: "A", type: "discord", webhookUrl: `${base}/a` },
        { ...common, id: "b", name: "B", enabled: false, type: "discord", webhookUrl: `${base}/b` },
      ],
    };
    const result = await dispatch(config, notification([available]));
    status = 200;
    assert.equal(result.attempted, 1);
    assert.deepEqual(result.delivered, []);
    assert.match(result.failures[0]!.error, /HTTP 401 Unauthorized: \{"message":"unauthorized"\}/);
  });
});
