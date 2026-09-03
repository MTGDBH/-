(function (global) {
  "use strict";

  // Bluetooth SIG 标准健康服务。厂商私有手环需要另行适配协议和鉴权。
  const UUID = Object.freeze({
    HEART_RATE_SERVICE: 0x180d,
    BLOOD_PRESSURE_SERVICE: 0x1810,
    THERMOMETER_SERVICE: 0x1809,
    GLUCOSE_SERVICE: 0x1808,
    PULSE_OXIMETER_SERVICE: 0x1822,
    WEIGHT_SCALE_SERVICE: 0x181d,
    BATTERY_SERVICE: 0x180f,
    DEVICE_INFORMATION_SERVICE: 0x180a,
    HEART_RATE_MEASUREMENT: 0x2a37,
    BLOOD_PRESSURE_MEASUREMENT: 0x2a35,
    INTERMEDIATE_CUFF_PRESSURE: 0x2a36,
    TEMPERATURE_MEASUREMENT: 0x2a1c,
    INTERMEDIATE_TEMPERATURE: 0x2a1e,
    GLUCOSE_MEASUREMENT: 0x2a18,
    PLX_SPOT_CHECK_MEASUREMENT: 0x2a5e,
    PLX_CONTINUOUS_MEASUREMENT: 0x2a5f,
    WEIGHT_MEASUREMENT: 0x2a9d,
    BATTERY_LEVEL: 0x2a19,
    MODEL_NUMBER: 0x2a24,
    MANUFACTURER_NAME: 0x2a29,
  });

  const OPTIONAL_SERVICES = [
    UUID.HEART_RATE_SERVICE,
    UUID.BLOOD_PRESSURE_SERVICE,
    UUID.THERMOMETER_SERVICE,
    UUID.GLUCOSE_SERVICE,
    UUID.PULSE_OXIMETER_SERVICE,
    UUID.WEIGHT_SCALE_SERVICE,
    UUID.BATTERY_SERVICE,
    UUID.DEVICE_INFORMATION_SERVICE,
  ];

  const toView = (value) =>
    value instanceof DataView
      ? value
      : new DataView(value.buffer || value, value.byteOffset || 0, value.byteLength);

  function signed(value, bits) {
    const sign = 1 << (bits - 1);
    return value & sign ? value - (1 << bits) : value;
  }

  function readSfloat(view, offset) {
    if (offset + 2 > view.byteLength) return null;
    const raw = view.getUint16(offset, true);
    if ([0x07ff, 0x0800, 0x0801, 0x0802, 0x07fe].includes(raw)) return null;
    const mantissa = signed(raw & 0x0fff, 12);
    const exponent = signed((raw >> 12) & 0x0f, 4);
    const result = mantissa * (10 ** exponent);
    return Number.isFinite(result) ? result : null;
  }

  function readFloat11073(view, offset) {
    if (offset + 4 > view.byteLength) return null;
    const raw = view.getUint32(offset, true);
    const mantissaRaw = raw & 0x00ffffff;
    if ([0x007fffff, 0x00800000, 0x00800001, 0x00800002, 0x007ffffe].includes(mantissaRaw)) return null;
    const mantissa = signed(mantissaRaw, 24);
    const exponent = signed((raw >>> 24) & 0xff, 8);
    const result = mantissa * (10 ** exponent);
    return Number.isFinite(result) ? result : null;
  }

  function readDateTime(view, offset) {
    if (offset + 7 > view.byteLength) return null;
    const year = view.getUint16(offset, true);
    const month = view.getUint8(offset + 2);
    const day = view.getUint8(offset + 3);
    const hour = view.getUint8(offset + 4);
    const minute = view.getUint8(offset + 5);
    const second = view.getUint8(offset + 6);
    if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(year, month - 1, day, hour, minute, second);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const rounded = (value, digits = 1) => Number(Number(value).toFixed(digits));
  const measuredNow = () => new Date().toISOString();

  function parseHeartRateMeasurement(value) {
    const view = toView(value);
    if (view.byteLength < 2) return [];
    const flags = view.getUint8(0);
    const isUint16 = Boolean(flags & 0x01);
    if (isUint16 && view.byteLength < 3) return [];
    const heartRate = isUint16 ? view.getUint16(1, true) : view.getUint8(1);
    if (!Number.isFinite(heartRate) || heartRate <= 0) return [];
    return [{ type: "hr", label: "心率", value: heartRate, unit: "bpm", recorded_at: measuredNow() }];
  }

  function parseBloodPressureMeasurement(value) {
    const view = toView(value);
    if (view.byteLength < 7) return [];
    const flags = view.getUint8(0);
    const factor = flags & 0x01 ? 7.50062 : 1;
    const systolic = readSfloat(view, 1);
    const diastolic = readSfloat(view, 3);
    let offset = 7;
    let recordedAt = measuredNow();
    if (flags & 0x02) {
      recordedAt = readDateTime(view, offset) || recordedAt;
      offset += 7;
    }
    const result = [];
    if (systolic != null && diastolic != null) {
      result.push({
        type: "bp", label: "血压", value: rounded(systolic * factor, 0),
        value2: rounded(diastolic * factor, 0), unit: "mmHg", recorded_at: recordedAt,
      });
    }
    if ((flags & 0x04) && offset + 2 <= view.byteLength) {
      const pulse = readSfloat(view, offset);
      if (pulse != null && pulse > 0) result.push({ type: "hr", label: "心率", value: rounded(pulse, 0), unit: "bpm", recorded_at: recordedAt });
    }
    return result;
  }

  function parseTemperatureMeasurement(value) {
    const view = toView(value);
    if (view.byteLength < 5) return [];
    const flags = view.getUint8(0);
    let temperature = readFloat11073(view, 1);
    if (temperature == null) return [];
    if (flags & 0x01) temperature = (temperature - 32) * (5 / 9);
    const recordedAt = flags & 0x02 ? readDateTime(view, 5) || measuredNow() : measuredNow();
    return [{ type: "temp", label: "体温", value: rounded(temperature, 1), unit: "°C", recorded_at: recordedAt }];
  }

  function parseWeightMeasurement(value) {
    const view = toView(value);
    if (view.byteLength < 3) return [];
    const flags = view.getUint8(0);
    const raw = view.getUint16(1, true);
    const weightKg = flags & 0x01 ? (raw * 0.01) / 2.2046226218 : raw * 0.005;
    const recordedAt = flags & 0x02 ? readDateTime(view, 3) || measuredNow() : measuredNow();
    return [{ type: "weight", label: "体重", value: rounded(weightKg, 2), unit: "kg", recorded_at: recordedAt }];
  }

  function parsePulseOximeterMeasurement(value, spotCheck = true) {
    const view = toView(value);
    if (view.byteLength < 5) return [];
    const flags = view.getUint8(0);
    const oxygen = readSfloat(view, 1);
    const pulse = readSfloat(view, 3);
    const recordedAt = spotCheck && (flags & 0x01) ? readDateTime(view, 5) || measuredNow() : measuredNow();
    const result = [];
    if (oxygen != null && oxygen > 0) result.push({ type: "spo2", label: "血氧", value: rounded(oxygen, 1), unit: "%", recorded_at: recordedAt });
    if (pulse != null && pulse > 0) result.push({ type: "hr", label: "心率", value: rounded(pulse, 0), unit: "bpm", recorded_at: recordedAt });
    return result;
  }

  const parsePulseOximeterContinuousMeasurement = (value) => parsePulseOximeterMeasurement(value, false);

  function parseGlucoseMeasurement(value) {
    const view = toView(value);
    if (view.byteLength < 10) return [];
    const flags = view.getUint8(0);
    let offset = 10;
    const recordedAt = readDateTime(view, 3) || measuredNow();
    if (flags & 0x01) offset += 2;
    if (!(flags & 0x02) || offset + 2 > view.byteLength) return [];
    const concentration = readSfloat(view, offset);
    if (concentration == null) return [];
    const mmolPerL = flags & 0x04 ? concentration * 1000 : concentration * 5550.93;
    return [{ type: "glucose", label: "血糖", value: rounded(mmolPerL, 2), unit: "mmol/L", recorded_at: recordedAt }];
  }

  const HEALTH_SERVICES = [
    { uuid: UUID.HEART_RATE_SERVICE, label: "心率", characteristics: [
      { uuid: UUID.HEART_RATE_MEASUREMENT, parse: parseHeartRateMeasurement },
    ] },
    { uuid: UUID.BLOOD_PRESSURE_SERVICE, label: "血压", characteristics: [
      { uuid: UUID.BLOOD_PRESSURE_MEASUREMENT, parse: parseBloodPressureMeasurement },
    ] },
    { uuid: UUID.THERMOMETER_SERVICE, label: "体温", characteristics: [
      { uuid: UUID.TEMPERATURE_MEASUREMENT, parse: parseTemperatureMeasurement },
      { uuid: UUID.INTERMEDIATE_TEMPERATURE, parse: parseTemperatureMeasurement },
    ] },
    { uuid: UUID.GLUCOSE_SERVICE, label: "血糖", characteristics: [
      { uuid: UUID.GLUCOSE_MEASUREMENT, parse: parseGlucoseMeasurement },
    ] },
    { uuid: UUID.PULSE_OXIMETER_SERVICE, label: "血氧", characteristics: [
      { uuid: UUID.PLX_SPOT_CHECK_MEASUREMENT, parse: parsePulseOximeterMeasurement },
      { uuid: UUID.PLX_CONTINUOUS_MEASUREMENT, parse: parsePulseOximeterContinuousMeasurement },
    ] },
    { uuid: UUID.WEIGHT_SCALE_SERVICE, label: "体重", characteristics: [
      { uuid: UUID.WEIGHT_MEASUREMENT, parse: parseWeightMeasurement },
    ] },
  ];

  let activeDevice = null;
  let activeServer = null;
  let activeHandlers = {};
  const subscriptions = [];

  function isSupported() {
    return typeof navigator !== "undefined" && Boolean(navigator.bluetooth) && global.isSecureContext !== false;
  }

  function readableError(error) {
    if (error?.name === "NotFoundError") return "没有选择设备，连接已取消";
    if (error?.name === "SecurityError") return "浏览器未允许蓝牙访问，请使用 HTTPS 或本机地址并重试";
    if (error?.name === "NetworkError") return "蓝牙连接失败，请让手环靠近手机后重试";
    return error?.message || "蓝牙连接失败，请稍后重试";
  }

  function emitMeasurements(parser, value) {
    let measurements = [];
    try { measurements = parser(value) || []; } catch { return; }
    measurements.forEach((measurement) => activeHandlers.onMeasurement?.(measurement));
  }

  async function attachCharacteristic(service, definition) {
    let characteristic;
    try { characteristic = await service.getCharacteristic(definition.uuid); } catch { return false; }
    const handler = (event) => emitMeasurements(definition.parse, event.target.value);
    if (characteristic.properties?.read) {
      try { emitMeasurements(definition.parse, await characteristic.readValue()); } catch {}
    }
    if (characteristic.properties?.notify || characteristic.properties?.indicate) {
      try {
        characteristic.addEventListener("characteristicvaluechanged", handler);
        await characteristic.startNotifications();
        subscriptions.push({ characteristic, handler });
      } catch {
        characteristic.removeEventListener("characteristicvaluechanged", handler);
      }
    }
    return true;
  }

  async function readBattery(server) {
    try {
      const service = await server.getPrimaryService(UUID.BATTERY_SERVICE);
      const characteristic = await service.getCharacteristic(UUID.BATTERY_LEVEL);
      const value = await characteristic.readValue();
      return Math.max(0, Math.min(100, value.getUint8(0)));
    } catch { return null; }
  }

  async function readDeviceInformation(server) {
    const info = {};
    try {
      const service = await server.getPrimaryService(UUID.DEVICE_INFORMATION_SERVICE);
      for (const [key, uuid] of [["manufacturer", UUID.MANUFACTURER_NAME], ["model", UUID.MODEL_NUMBER]]) {
        try {
          const value = await (await service.getCharacteristic(uuid)).readValue();
          info[key] = new TextDecoder("utf-8").decode(value).replace(/\0/g, "").trim();
        } catch {}
      }
    } catch {}
    return info;
  }

  function cleanSubscriptions() {
    while (subscriptions.length) {
      const { characteristic, handler } = subscriptions.pop();
      try { characteristic.removeEventListener("characteristicvaluechanged", handler); } catch {}
    }
  }

  async function requestAndConnect(handlers = {}) {
    if (!isSupported()) throw new Error("当前浏览器不支持网页蓝牙，请使用安卓 Chrome 或电脑 Chrome / Edge");
    activeHandlers = handlers;
    cleanSubscriptions();
    handlers.onStatus?.("choosing", "请选择您的手环或健康设备");
    try {
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: OPTIONAL_SERVICES,
      });
      handlers.onStatus?.("connecting", `正在连接 ${device.name || "蓝牙设备"}`);
      activeDevice = device;
      device.addEventListener("gattserverdisconnected", () => {
        cleanSubscriptions();
        activeServer = null;
        activeHandlers.onDisconnect?.(device);
      }, { once: true });
      activeServer = await device.gatt.connect();

      const supported = [];
      for (const definition of HEALTH_SERVICES) {
        let service;
        try { service = await activeServer.getPrimaryService(definition.uuid); } catch { continue; }
        let attached = false;
        for (const characteristic of definition.characteristics) {
          attached = (await attachCharacteristic(service, characteristic)) || attached;
        }
        if (attached) supported.push(definition.label);
      }
      const battery = await readBattery(activeServer);
      const info = await readDeviceInformation(activeServer);
      const result = {
        id: device.id,
        name: device.name || info.model || "未命名蓝牙设备",
        connected: Boolean(activeServer.connected),
        battery,
        manufacturer: info.manufacturer || "",
        model: info.model || "",
        supported,
      };
      handlers.onStatus?.(supported.length ? "connected" : "limited", supported.length
        ? `已连接，可读取：${supported.join("、")}`
        : "已连接，但设备没有开放标准健康服务");
      return result;
    } catch (error) {
      handlers.onStatus?.("error", readableError(error));
      throw new Error(readableError(error));
    }
  }

  function disconnect() {
    cleanSubscriptions();
    if (activeDevice?.gatt?.connected) activeDevice.gatt.disconnect();
    activeServer = null;
  }

  global.BluetoothHealth = Object.freeze({
    UUID,
    isSupported,
    requestAndConnect,
    disconnect,
    parsers: Object.freeze({
      readSfloat,
      readFloat11073,
      parseHeartRateMeasurement,
      parseBloodPressureMeasurement,
      parseTemperatureMeasurement,
      parseWeightMeasurement,
      parsePulseOximeterMeasurement,
      parseGlucoseMeasurement,
    }),
  });
})(typeof window !== "undefined" ? window : globalThis);
