import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../scripts/wisp/headless";
import { installDispatch, on, trampoline } from "../src/platform/dispatch";
import { installNativeDriver, publishNativeDriverStatus, serviceNativeDriver, startNativeDriver } from "../src/platform/nativeDriver";
import { configureRuntime } from "../src/runtime/config";
import { driverCommandFile, driverReadyFile, driverStatusFile } from "../src/runtime/nativeDriver";

const runtime = installHeadless({ filePrefix: "fixture", globalPrefixes: ["__fixture"] });
afterAll(runtime.restore);
const entry = {
  install() {
    configureRuntime({ filePrefix: "fixture", globalPrefix: "__fixture", readyPrefix: "FX_HRR" });
    installDispatch();
    installNativeDriver(text => {
      // Creating the same handle in this handler catches delivery on different turns.
      CreateTimer();
      publishNativeDriverStatus(Number(text), "123:456", true);
    });
    on("fixture.tick", serviceNativeDriver);
  },
  start() {
    this.install();
    startNativeDriver([0, 1]);
    TimerStart(CreateTimer(), 1 / 60, true, trampoline("fixture.tick"));
  },
};

test("[invariant] numbered FileIO commands execute on the same event after both payloads agree", () => {
  const clients = runtime.clients(entry);
  clients.start();
  for (let serial = 1; serial <= 3; serial++) {
    clients.publish(driverCommandFile("fixture", serial), [String(serial * 10)]);
    clients.frames(4);
    for (const client of clients.clients) expect(client.files.get(driverStatusFile("fixture"))?.[0]).toStartWith(`drive ${serial - 1} `);
    clients.publish(driverReadyFile("fixture", serial), ["ready"]);
    clients.frames(12);
    for (const client of clients.clients) {
      expect(client.files.get(driverStatusFile("fixture"))?.[0]).toStartWith(`drive ${serial} ${serial * 10} 123:456 1 3 `);
      expect(client.errors).toEqual([]);
    }
  }
  expect(clients.firstDivergence()).toBeUndefined();
});

test("[invariant] different client payloads refuse the command on both clients", () => {
  const clients = runtime.clients(entry);
  clients.start();
  clients.client(0).published.set(driverCommandFile("fixture", 1), ["10"]);
  clients.client(1).published.set(driverCommandFile("fixture", 1), ["11"]);
  clients.publish(driverReadyFile("fixture", 1), ["ready"]);
  clients.frames(16);
  for (const client of clients.clients) {
    const receipt = client.files.get(driverStatusFile("fixture"))?.[0];
    expect(receipt).toStartWith("drive 0 0 00000000 1 3 ");
    expect(receipt).toEndWith(" 1");
    expect(client.errors).toEqual([]);
  }
  expect(clients.firstDivergence()).toBeUndefined();
});
