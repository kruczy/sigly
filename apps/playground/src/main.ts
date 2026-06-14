import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, basicSetup } from "codemirror";

import "./style.css";

type EditorId = "html" | "css" | "js";

type ConsoleEntry = {
  readonly level: "error" | "info" | "log" | "warn";
  readonly message: string;
};

const starterCode: Record<EditorId, string> = {
  html: `<main class="panel">
  <section>
    <p class="eyebrow">Sigly starter</p>
    <h1>Reactive invoice</h1>
  </section>

  <div class="controls">
    <label>
      Quantity
      <input id="quantity" type="range" min="1" max="12" value="3" />
      <output id="quantity-value">3</output>
    </label>

    <label>
      Unit price
      <input id="unit-price" type="range" min="8" max="80" value="24" />
      <output id="unit-price-value">$24</output>
    </label>

    <label class="check">
      <input id="discount-enabled" type="checkbox" checked />
      <span>15% discount</span>
    </label>
  </div>

  <dl class="totals">
    <div>
      <dt>Subtotal</dt>
      <dd id="subtotal">$72.00</dd>
    </div>
    <div>
      <dt>Discount</dt>
      <dd id="discount">$10.80</dd>
    </div>
    <div>
      <dt>Total</dt>
      <dd id="total">$61.20</dd>
    </div>
  </dl>
</main>`,
  css: `body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: #eef2f6;
  color: #17212b;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
}

.panel {
  width: min(720px, calc(100% - 32px));
  padding: 28px;
  border: 1px solid #d5dee8;
  border-radius: 8px;
  background: white;
  box-shadow: 0 20px 50px rgb(39 55 77 / 12%);
}

.eyebrow {
  margin: 0 0 4px;
  color: #0b7a75;
  font-size: 0.75rem;
  font-weight: 800;
  text-transform: uppercase;
}

h1 {
  margin: 0 0 24px;
  font-size: 2.5rem;
  line-height: 1;
}

.controls {
  display: grid;
  gap: 18px;
}

label {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px 14px;
  font-weight: 700;
}

input[type="range"] {
  grid-column: 1 / -1;
  accent-color: #0b7a75;
}

output {
  color: #c7472f;
  font-variant-numeric: tabular-nums;
}

.check {
  display: flex;
  align-items: center;
  gap: 10px;
}

.totals {
  display: grid;
  gap: 0;
  margin: 24px 0 0;
}

.totals div {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 16px;
  padding: 14px 0;
  border-top: 1px solid #e4eaf1;
}

dt {
  color: #5d6b7a;
  font-weight: 700;
}

dd {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 850;
}

.totals div:last-child dd {
  color: #0b7a75;
  font-size: 2.2rem;
}`,
  js: `import { computed$, value$ } from "sigly";

const quantity = value$(3);
const unitPrice = value$(24);
const discountEnabled = value$(true);

const subtotal = computed$(() => quantity.get() * unitPrice.get());
const discount = computed$(() => (discountEnabled.get() ? subtotal.get() * 0.15 : 0));
const total = computed$(() => subtotal.get() - discount.get());

const elements = {
  quantity: document.querySelector("#quantity"),
  quantityValue: document.querySelector("#quantity-value"),
  unitPrice: document.querySelector("#unit-price"),
  unitPriceValue: document.querySelector("#unit-price-value"),
  discountEnabled: document.querySelector("#discount-enabled"),
  subtotal: document.querySelector("#subtotal"),
  discount: document.querySelector("#discount"),
  total: document.querySelector("#total"),
};

const money = new Intl.NumberFormat("en-US", {
  currency: "USD",
  style: "currency",
});

total.subscribe((value, previousValue) => {
  console.log("total", { value, previousValue });
});

elements.quantity.addEventListener("input", () => {
  quantity.set(elements.quantity.valueAsNumber);
  render();
});

elements.unitPrice.addEventListener("input", () => {
  unitPrice.set(elements.unitPrice.valueAsNumber);
  render();
});

elements.discountEnabled.addEventListener("change", () => {
  discountEnabled.set(elements.discountEnabled.checked);
  render();
});

render();

function render() {
  elements.quantity.value = String(quantity.peek());
  elements.quantityValue.value = String(quantity.peek());
  elements.unitPrice.value = String(unitPrice.peek());
  elements.unitPriceValue.value = money.format(unitPrice.peek());
  elements.discountEnabled.checked = discountEnabled.peek();

  elements.subtotal.textContent = money.format(subtotal.peek());
  elements.discount.textContent = money.format(discount.peek());
  elements.total.textContent = money.format(total.peek());
}`,
};

const consoleEntries: ConsoleEntry[] = [];
const editorViews = new Map<EditorId, EditorView>();
let activeEditor: EditorId = "html";
let autoRun = true;
let consoleOpen = false;
let runTimer: number | undefined;

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">Sigly</p>
        <h1>Playground</h1>
      </div>

      <div class="toolbar" aria-label="Playground controls">
        <label class="auto-run">
          <input id="auto-run" type="checkbox" checked />
          <span>Auto-run</span>
        </label>
        <button id="run-button" type="button">Run</button>
        <button id="reset-button" type="button">Reset</button>
      </div>
    </header>

    <section class="workspace" aria-label="Editable Sigly playground">
      <article class="pane editor-pane">
        <header class="pane-header editor-header">
          <div class="editor-tabs" role="tablist" aria-label="Code editors">
            <button class="editor-tab is-active" id="html-tab" type="button" role="tab" aria-controls="html-panel" aria-selected="true" data-editor="html">HTML</button>
            <button class="editor-tab" id="css-tab" type="button" role="tab" aria-controls="css-panel" aria-selected="false" data-editor="css">CSS</button>
            <button class="editor-tab" id="js-tab" type="button" role="tab" aria-controls="js-panel" aria-selected="false" data-editor="js">JS</button>
          </div>
        </header>

        <div class="editor-stack">
          <section id="html-panel" class="editor-panel is-active" role="tabpanel" aria-labelledby="html-tab">
            <div id="html-editor" class="editor"></div>
          </section>

          <section id="css-panel" class="editor-panel" role="tabpanel" aria-labelledby="css-tab" hidden>
            <div id="css-editor" class="editor"></div>
          </section>

          <section id="js-panel" class="editor-panel" role="tabpanel" aria-labelledby="js-tab" hidden>
            <div id="js-editor" class="editor"></div>
          </section>
        </div>
      </article>

      <article class="pane preview-pane">
        <header class="pane-header">
          <span>Preview</span>
        </header>
        <iframe id="preview" title="Sigly playground preview" sandbox="allow-scripts"></iframe>
      </article>
    </section>

    <section class="console-drawer" aria-label="Playground console">
      <header class="console-header">
        <button id="console-toggle" type="button" aria-expanded="false" aria-controls="console-output">
          <span>Console</span>
          <span id="console-count" class="console-count">0</span>
        </button>
      </header>
      <ol id="console-output" class="console-output" hidden></ol>
    </section>
  </main>
`;

const preview = requireElement("#preview", HTMLIFrameElement);
const consoleDrawer = requireElement(".console-drawer", HTMLElement);
const consoleOutput = requireElement("#console-output", HTMLOListElement);
const consoleToggle = requireElement("#console-toggle", HTMLButtonElement);
const consoleCount = requireElement("#console-count", HTMLElement);
const autoRunInput = requireElement("#auto-run", HTMLInputElement);
const runButton = requireElement("#run-button", HTMLButtonElement);
const resetButton = requireElement("#reset-button", HTMLButtonElement);

mountEditor("html", "#html-editor", html(), starterCode.html);
mountEditor("css", "#css-editor", css(), starterCode.css);
mountEditor("js", "#js-editor", javascript(), starterCode.js);

for (const tab of document.querySelectorAll<HTMLButtonElement>(".editor-tab")) {
  tab.addEventListener("click", () => {
    if (isEditorId(tab.dataset.editor)) {
      switchEditor(tab.dataset.editor);
    }
  });
}

autoRunInput.addEventListener("change", () => {
  autoRun = autoRunInput.checked;
});

runButton.addEventListener("click", () => {
  runPreview();
});

resetButton.addEventListener("click", () => {
  for (const id of editorViews.keys()) {
    setEditorValue(id, starterCode[id]);
  }

  runPreview();
});

consoleToggle.addEventListener("click", () => {
  setConsoleOpen(!consoleOpen);
});

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== preview.contentWindow || !isConsoleMessage(event.data)) {
    return;
  }

  addConsoleEntry(event.data.level, event.data.message);
});

runPreview();

function mountEditor(
  id: EditorId,
  selector: string,
  languageExtension: ReturnType<typeof html>,
  initialValue: string,
): void {
  const parent = requireElement(selector, HTMLElement);
  const view = new EditorView({
    doc: initialValue,
    extensions: [
      basicSetup,
      languageExtension,
      oneDark,
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && autoRun) {
          scheduleRun();
        }
      }),
    ],
    parent,
  });

  editorViews.set(id, view);
}

function switchEditor(id: EditorId): void {
  if (id === activeEditor) {
    return;
  }

  activeEditor = id;

  for (const tab of document.querySelectorAll<HTMLButtonElement>(".editor-tab")) {
    const selected = tab.dataset.editor === id;

    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
  }

  for (const panel of document.querySelectorAll<HTMLElement>(".editor-panel")) {
    const selected = panel.id === `${id}-panel`;

    panel.hidden = !selected;
    panel.classList.toggle("is-active", selected);
  }

  const view = editorViews.get(id);

  view?.requestMeasure();
  view?.focus();
}

function setConsoleOpen(open: boolean): void {
  consoleOpen = open;
  consoleDrawer.classList.toggle("is-open", open);
  consoleOutput.hidden = !open;
  consoleToggle.setAttribute("aria-expanded", String(open));
}

function scheduleRun(): void {
  window.clearTimeout(runTimer);
  runTimer = window.setTimeout(runPreview, 350);
}

function runPreview(): void {
  consoleEntries.length = 0;
  renderConsole();

  preview.srcdoc = buildPreviewDocument({
    css: getEditorValue("css"),
    html: getEditorValue("html"),
    js: getEditorValue("js"),
  });
}

function buildPreviewDocument(code: Record<EditorId, string>): string {
  const importMap = JSON.stringify({
    imports: {
      sigly: `${window.location.origin}/sigly/index.js`,
    },
  });

  const runner = `
    const send = (level, values) => {
      parent.postMessage({
        source: "sigly-playground",
        level,
        message: values.map((value) => {
          if (typeof value === "string") {
            return value;
          }

          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        }).join(" ")
      }, "*");
    };

    for (const level of ["error", "info", "log", "warn"]) {
      const original = console[level].bind(console);

      console[level] = (...values) => {
        original(...values);
        send(level, values);
      };
    }

    window.addEventListener("error", (event) => {
      send("error", [event.message]);
    });

    window.addEventListener("unhandledrejection", (event) => {
      send("error", [event.reason]);
    });
  `;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <script type="importmap">${escapeInlineScript(importMap)}</script>
    <style>${code.css}</style>
  </head>
  <body>
    ${code.html}
    <script>${escapeInlineScript(runner)}</script>
    <script type="module">${escapeInlineScript(code.js)}</script>
  </body>
</html>`;
}

function getEditorValue(id: EditorId): string {
  const view = editorViews.get(id);

  if (view === undefined) {
    throw new Error(`Missing ${id} editor.`);
  }

  return view.state.doc.toString();
}

function setEditorValue(id: EditorId, value: string): void {
  const view = editorViews.get(id);

  if (view === undefined) {
    throw new Error(`Missing ${id} editor.`);
  }

  view.dispatch({
    changes: {
      from: 0,
      insert: value,
      to: view.state.doc.length,
    },
  });
}

function addConsoleEntry(level: ConsoleEntry["level"], message: string): void {
  consoleEntries.push({ level, message });
  consoleEntries.splice(80);
  renderConsole();
}

function renderConsole(): void {
  consoleCount.textContent = String(consoleEntries.length);
  consoleOutput.replaceChildren(
    ...consoleEntries.map((entry) => {
      const item = document.createElement("li");
      item.className = `console-${entry.level}`;
      item.textContent = entry.message;
      return item;
    }),
  );
}

function escapeInlineScript(value: string): string {
  return value.replaceAll("</script", "<\\/script");
}

function isEditorId(value: string | undefined): value is EditorId {
  return value === "html" || value === "css" || value === "js";
}

function isConsoleMessage(
  value: unknown,
): value is ConsoleEntry & { readonly source: "sigly-playground" } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (!("source" in value) || !("level" in value) || !("message" in value)) {
    return false;
  }

  return (
    value.source === "sigly-playground" &&
    typeof value.message === "string" &&
    (value.level === "error" ||
      value.level === "info" ||
      value.level === "log" ||
      value.level === "warn")
  );
}

function requireElement<T extends Element>(selector: string, type: new () => T): T {
  const element = document.querySelector(selector);

  if (!(element instanceof type)) {
    throw new Error(`Missing playground element: ${selector}`);
  }

  return element;
}
