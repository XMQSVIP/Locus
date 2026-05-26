# Locus

Locus is a Chrome / Firefox MV3 browser extension for capturing XPath, CSS Selector, text details, and JS/Python extraction regex snippets from web page elements. Normal capture does not compute similar elements by default. Similar element search is a separate two-step workflow: capture one sample, then capture a second matching sample under the same parent node.

Author: 玛卡巴卡大王. WeChat Official Account: 大王的琅琊阁.

中文文档: [README.md](README.md)

## Features

- Direct capture defaults to `Ctrl+Shift + left click`.
- `Alt+Z` toggles hover capture mode. The element under the pointer gets a live red outline; click or press `Enter` to capture it.
- `Ctrl+Shift+Z` captures the current element under the pointer or red outline without clicking.
- `Alt+X` validates the current XPath/CSS expression in the panel and flashes matching elements with a red border.
- The floating panel shows XPath, CSS Selector, text, useful text attributes, and JS/Python extraction regex snippets.
- Regex snippets are generated from element HTML. Normal elements extract text values; image, video, and audio elements extract media links.
- Similar element search is separate: capture the first sample, click "查找相似元素", then capture a second matching sample under the same parent node to generate list XPath/CSS expressions.
- Supports normal pages and same-origin/cross-origin iframe capture. Similar search samples must be selected under the same parent node inside the same page or iframe.
- Options page supports capture modifier, default copy format, maximum similar result count, and regex display settings.

## Usage

1. Load the extension and open a web page.
2. Hold `Ctrl+Shift` and left-click an element, or press `Ctrl+Shift+Z` to capture the element under the pointer.
3. Copy XPath, CSS, text, or regex snippets from the right-side panel; edit XPath/CSS and click validate when needed.
4. To find a similar element list, capture the first sample, click "查找相似元素" in the panel, then capture a second matching sample under the same parent node.
5. The similar result view shows list XPath/CSS, match count, and candidate elements. Click validate to flash all matched elements and show the validated element count.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

Build outputs:

- Chrome: `dist/chrome`
- Firefox: `dist/firefox`

Firefox debugging:

```bash
npx web-ext run -s dist/firefox
```

Chrome debugging: open `chrome://extensions`, enable Developer mode, and load `dist/chrome`.

## Local Test Page

After building and loading the extension, open `test-pages/index.html` to verify basic elements, similar elements, media elements, hover menus, and iframe capture.
