import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { xiaozhiPlugin } from "./src/channel.js";

const plugin = {
  id: "xiaozhi",
  name: "Xiaozhi",
  description: "Xiaozhi Protocol channel plugin for ESP32 robots",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.registerChannel({ plugin: xiaozhiPlugin });
  },
};

export default plugin;