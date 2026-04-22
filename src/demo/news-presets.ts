import type { ExtractionRequest } from '../domain/extraction/types.js';
import type { SupportedNewsSite } from '../domain/news-import/types.js';

export type LiveNewsPreset = {
  id: string;
  title: string;
  sourceSite: SupportedNewsSite;
  articleUrl: string;
  excerpt: string;
  text: string;
  request: ExtractionRequest;
};

const createPresetRequest = (preset: {
  title: string;
  text: string;
  articleUrl: string;
  sourceSite: SupportedNewsSite;
}): ExtractionRequest => ({
  sourceType: 'news',
  title: preset.title,
  text: preset.text,
  metadata: {
    articleUrl: preset.articleUrl,
    sourceSite: preset.sourceSite,
    importMode: 'preset'
  }
});

export const liveNewsPresets: LiveNewsPreset[] = [
  {
    id: 'wublock123-hk-etf',
    title: '吴说获悉：香港虚拟资产 ETF 本周净流入创新高',
    sourceSite: 'wublock123',
    articleUrl: 'https://wublock123.com/p/654321',
    excerpt: '香港比特币与以太坊现货 ETF 本周净流入创阶段新高。',
    text: [
      '香港比特币与以太坊现货 ETF 本周净流入达到近三个月高点，资金继续回流亚洲市场。',
      '多家发行机构表示，机构配置需求与市场风险偏好改善共同推动了本轮申购增长。'
    ].join('\n\n'),
    request: createPresetRequest({
      title: '吴说获悉：香港虚拟资产 ETF 本周净流入创新高',
      text: [
        '香港比特币与以太坊现货 ETF 本周净流入达到近三个月高点，资金继续回流亚洲市场。',
        '多家发行机构表示，机构配置需求与市场风险偏好改善共同推动了本轮申购增长。'
      ].join('\n\n'),
      articleUrl: 'https://wublock123.com/p/654321',
      sourceSite: 'wublock123'
    })
  },
  {
    id: 'panews-funding-round',
    title: 'PANews：某协议完成 5000 万美元融资',
    sourceSite: 'panews',
    articleUrl: 'https://www.panewslab.com/articles/0123456789',
    excerpt: 'PANews 报道，某协议完成新一轮融资并计划扩展亚洲市场。',
    text: [
      'PANews 4 月 22 日消息，某协议宣布完成 5000 万美元融资，由多家加密基金参投。',
      '团队表示，新资金将用于扩展亚洲市场、完善链上清算与合规能力。'
    ].join('\n\n'),
    request: createPresetRequest({
      title: 'PANews：某协议完成 5000 万美元融资',
      text: [
        'PANews 4 月 22 日消息，某协议宣布完成 5000 万美元融资，由多家加密基金参投。',
        '团队表示，新资金将用于扩展亚洲市场、完善链上清算与合规能力。'
      ].join('\n\n'),
      articleUrl: 'https://www.panewslab.com/articles/0123456789',
      sourceSite: 'panews'
    })
  },
  {
    id: 'chaincatcher-asia-expansion',
    title: 'ChainCatcher：模块化基础设施项目加速亚洲扩张',
    sourceSite: 'chaincatcher',
    articleUrl: 'https://www.chaincatcher.com/article/1234567.html',
    excerpt: 'ChainCatcher 报道，某模块化基础设施项目宣布扩展亚洲支付与数据服务布局。',
    text: [
      'ChainCatcher 4 月 22 日消息，某模块化基础设施项目宣布将其支付与数据服务节点扩展至新加坡、香港与首尔。',
      '项目团队表示，新部署将优先服务稳定币结算、数据可用性和开发者工具三类核心场景。'
    ].join('\n\n'),
    request: createPresetRequest({
      title: 'ChainCatcher：模块化基础设施项目加速亚洲扩张',
      text: [
        'ChainCatcher 4 月 22 日消息，某模块化基础设施项目宣布将其支付与数据服务节点扩展至新加坡、香港与首尔。',
        '项目团队表示，新部署将优先服务稳定币结算、数据可用性和开发者工具三类核心场景。'
      ].join('\n\n'),
      articleUrl: 'https://www.chaincatcher.com/article/1234567.html',
      sourceSite: 'chaincatcher'
    })
  }
];
