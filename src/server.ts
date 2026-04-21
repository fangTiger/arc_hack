import { app } from './app.js';
import { env } from './config/env.js';

app.listen(env.port, () => {
  // 启动日志先保持最小，后续接入正式日志层时再统一收口。
  console.log(`paid-knowledge-extraction-api listening on port ${env.port}`);
});
