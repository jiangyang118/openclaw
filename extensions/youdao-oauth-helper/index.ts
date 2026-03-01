import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import {
  createYoudaoOauthHttpHandler,
  resolveYoudaoOauthConfig,
} from "./src/youdao-oauth-handler.js";

const plugin = {
  id: "youdao-oauth-helper",
  name: "Youdao OAuth Helper",
  description: "Provides OAuth start/callback endpoints for Youdao OpenAPI.",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    const resolved = resolveYoudaoOauthConfig(api.pluginConfig);
    for (const warning of resolved.warnings) {
      api.logger.warn(`[youdao-oauth-helper] ${warning}`);
    }
    api.registerHttpHandler(createYoudaoOauthHttpHandler({ logger: api.logger, config: resolved }));
    api.logger.info(
      `[youdao-oauth-helper] routes enabled: ${resolved.basePath}/start and ${resolved.basePath}/callback`,
    );
  },
};

export default plugin;
