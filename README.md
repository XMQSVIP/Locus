# Locus

Locus 是一个 Chrome / Firefox MV3 浏览器扩展，用于快速捕获网页元素的 XPath、CSS Selector、文本信息和 JS/Python 提取正则。普通捕获默认不计算相似元素；相似元素是独立的两步功能，需要先捕获一个样本，再捕获同一父节点下的第二个同类样本。

插件作者：玛卡巴卡大王，关注微信公众号：大王的琅琊阁

English documentation: [README.en.md](README.en.md)

## 功能

- 默认 `Ctrl+Shift + 鼠标左键` 直接捕获元素。
- `Alt+Z` 开启或关闭悬停捕获模式，鼠标下方元素实时显示红色边框，点击或按 `Enter` 捕获。
- `Ctrl+Shift+Z` 不点击鼠标，捕获当前鼠标下方或红框元素。
- `Alt+X` 校验当前面板中的 XPath/CSS 表达式，匹配元素会闪烁红色边框。
- 捕获结果面板展示 XPath、CSS Selector、文本、属性文本和 JS/Python 提取正则。
- 正则基于元素 HTML 生成，普通元素提取文本值，图片、视频、音频元素提取媒体链接。
- 相似元素独立查找：捕获第一个样本后点击“查找相似元素”，再捕获同一父节点下的第二个样本，生成列表 XPath/CSS。
- 支持普通页面、同源/跨源 iframe 内元素捕获；相似元素的两个样本必须在同一个页面或 iframe 的同一父节点下。
- 设置页支持修改捕获组合键、默认复制格式、相似元素最大结果数量和正则显示选项。

## 使用方法

1. 加载扩展后，打开任意网页。
2. 按住 `Ctrl+Shift` 并左键点击元素，或按 `Ctrl+Shift+Z` 捕获鼠标下方元素。
3. 在右侧面板复制 XPath、CSS、文本或正则；也可以编辑 XPath/CSS 后点击“校验”。
4. 需要相似元素列表时，先捕获第一个样本，点击面板中的“查找相似元素”，再捕获同一父节点下的第二个同类样本。
5. 相似结果会展示列表 XPath/CSS、匹配数量和候选元素；点击“校验”可让所有匹配元素闪烁，并显示校验到的元素数量。

## 开发

```bash
npm install
npm test
npm run typecheck
npm run build
```

构建产物：

- Chrome: `dist/chrome`
- Firefox: `dist/firefox`

Firefox 调试：

```bash
npx web-ext run -s dist/firefox
```

Chrome 调试：打开 `chrome://extensions`，启用开发者模式，加载 `dist/chrome`。

## 本地测试页

构建并加载扩展后，可以打开 `test-pages/index.html` 验证基础元素、相似元素、媒体元素、悬浮菜单和 iframe 捕获。
