import { createApp } from './app.js';
import { getRuntimeEnv } from './config/env.js';

const runtimeEnv = getRuntimeEnv();
const app = createApp({ runtimeEnv });

app.listen(runtimeEnv.port, () => {
  // 启动日志先保持最小，后续接入正式日志层时再统一收口。
  console.log(`paid-knowledge-extraction-api listening on port ${runtimeEnv.port}`);
});
