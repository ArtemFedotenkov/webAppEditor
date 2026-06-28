const telegramBridge = window.EditorTelegram || {
  closeWebApp() {
    const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
    if (!tg) return false;
    tg.close();
    return true;
  },
  getTelegramWebApp() {
    return window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  },
  sendWebAppData(payload) {
    const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
    if (!tg) return false;
    tg.sendData(JSON.stringify(payload));
    return true;
  },
};
const { closeWebApp, getTelegramWebApp, sendWebAppData } = telegramBridge;

const emptyDraft = {
  articleId: null,
  title: "",
  body: "",
  sourceUrl: "",
  media: {
    type: "none",
    url: "",
    fileName: "",
    spoiler: false,
  },
  buttons: [],
};

const state = cloneDraft(emptyDraft);
const elements = {};
let savedEditorRange = null;

const FORMAT_TAGS = {
  bold: "b",
  strong: "strong",
  italic: "i",
  underline: "u",
  strike: "s",
  spoiler: "tg-spoiler",
  quote: "blockquote",
  code: "code",
  link: "a",
};

const FORMAT_FALLBACKS = {
  bold: "жирный текст",
  strong: "очень жирный текст",
  italic: "курсив",
  underline: "подчеркнутый текст",
  strike: "зачеркнутый текст",
  spoiler: "спойлер",
  quote: "цитата",
  code: "код",
};

function initArticleEditor() {
  bindElements();
  loadInitialState();
  bindEvents();
  renderAll();

  const tg = getTelegramWebApp();
  if (tg) {
    tg.ready();
    tg.expand();
  }
}

window.initArticleEditor = initArticleEditor;
initArticleEditor();

function bindElements() {
  Object.assign(elements, {
    saveState: document.querySelector("#saveState"),
    closeButton: document.querySelector("#closeButton"),
    previewToggle: document.querySelector("#previewToggle"),
    previewPanel: document.querySelector("#previewPanel"),
    toast: document.querySelector("#toast"),
    titleInput: document.querySelector("#titleInput"),
    bodyEditor: document.querySelector("#bodyEditor"),
    sourceLink: document.querySelector("#sourceLink"),
    copySourceButton: document.querySelector("#copySourceButton"),
    mediaFileInput: document.querySelector("#mediaFileInput"),
    mediaUrlInput: document.querySelector("#mediaUrlInput"),
    mediaSpoilerInput: document.querySelector("#mediaSpoilerInput"),
    mediaFileField: document.querySelector("#mediaFileField"),
    mediaUrlField: document.querySelector("#mediaUrlField"),
    mediaPreview: document.querySelector("#mediaPreview"),
    buttonList: document.querySelector("#buttonList"),
    buttonTitleInput: document.querySelector("#buttonTitleInput"),
    buttonUrlInput: document.querySelector("#buttonUrlInput"),
    addButtonLink: document.querySelector("#addButtonLink"),
    previewTitle: document.querySelector("#previewTitle"),
    previewBody: document.querySelector("#previewBody"),
    previewSource: document.querySelector("#previewSource"),
    previewButtons: document.querySelector("#previewButtons"),
    previewMedia: document.querySelector("#previewMedia"),
    aiButton: document.querySelector("#aiButton"),
    resetButton: document.querySelector("#resetButton"),
    saveButton: document.querySelector("#saveButton"),
  });
}

function loadInitialState() {
  const url = new URL(window.location.href);
  const encodedDraft = url.searchParams.get("draft");
  const loaded = parseJson(decodeDraft(encodedDraft));

  if (loaded) {
    Object.assign(state, normalizeDraft(loaded));
  }
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => setActiveTab(button.dataset.tab));
  });

  document.querySelectorAll(".tool-button").forEach((button) => {
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      button.dataset.pointerHandled = "true";
      applyFormat(button.dataset.format);
    });
    button.addEventListener("click", () => {
      if (button.dataset.pointerHandled) {
        delete button.dataset.pointerHandled;
        return;
      }
      applyFormat(button.dataset.format);
    });
  });

  document.querySelectorAll(".segment").forEach((button) => {
    button.addEventListener("click", () => setMediaType(button.dataset.mediaType));
  });

  elements.titleInput.addEventListener("input", () => {
    state.title = elements.titleInput.value;
    markDirty();
    renderPreview();
  });

  elements.bodyEditor.addEventListener("input", () => {
    state.body = elements.bodyEditor.innerHTML;
    markDirty();
    renderPreview();
  });

  elements.bodyEditor.addEventListener("keyup", rememberSelectionAndToolbar);
  elements.bodyEditor.addEventListener("mouseup", rememberSelectionAndToolbar);
  document.addEventListener("selectionchange", rememberSelectionAndToolbar);

  elements.mediaSpoilerInput.addEventListener("change", () => {
    state.media.spoiler = elements.mediaSpoilerInput.checked;
    markDirty();
    renderMedia();
  });

  elements.mediaUrlInput.addEventListener("input", () => {
    state.media.url = elements.mediaUrlInput.value.trim();
    markDirty();
    renderMedia();
  });

  elements.mediaFileInput.addEventListener("change", () => {
    const file = elements.mediaFileInput.files && elements.mediaFileInput.files[0] ? elements.mediaFileInput.files[0] : null;
    state.media.fileName = file && file.name ? file.name : "";
    state.media.url = file ? URL.createObjectURL(file) : "";
    if (file && file.type && file.type.startsWith("video/")) {
      state.media.type = "video";
    } else if (file && file.type && file.type.startsWith("image/")) {
      state.media.type = "photo";
    }
    markDirty();
    renderAll();
  });

  elements.addButtonLink.addEventListener("click", addInlineButton);
  elements.copySourceButton.addEventListener("click", copySource);
  elements.aiButton.addEventListener("click", requestAiAdaptation);
  elements.resetButton.addEventListener("click", resetDraft);
  elements.saveButton.addEventListener("click", () => submitDraft("save"));
  elements.closeButton.addEventListener("click", () => {
    if (!closeWebApp()) {
      showToast("В Telegram эта кнопка закроет редактор.");
    }
  });
  elements.previewToggle.addEventListener("click", () => {
    elements.previewPanel.classList.toggle("is-open");
  });
}

function normalizeDraft(draft) {
  return {
    articleId: valueOr(valueOr(draft.articleId, draft.article_id), null),
    title: String(valueOr(draft.title, "")),
    body: String(valueOr(draft.body, valueOr(draft.text_final_html, ""))),
    sourceUrl: String(valueOr(draft.sourceUrl, valueOr(draft.source_url, ""))),
    media: {
      type: valueOr(draft.media && draft.media.type, valueOr(draft.media_type, "none")),
      url: valueOr(draft.media && draft.media.url, valueOr(draft.media_url, "")),
      fileName: valueOr(draft.media && draft.media.fileName, ""),
      spoiler: Boolean(valueOr(draft.media && draft.media.spoiler, valueOr(draft.media_spoiler_enabled, false))),
    },
    buttons: Array.isArray(draft.buttons) ? draft.buttons.map(normalizeButton).filter(Boolean) : [],
  };
}

function normalizeButton(button) {
  const title = String(valueOr(button.title, "")).trim();
  const url = String(valueOr(button.url, "")).trim();
  return title && url ? { title, url } : null;
}

function setActiveTab(tabName) {
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.panel === tabName);
  });
}

function applyFormat(format) {
  restoreEditorSelection();
  elements.bodyEditor.focus();
  restoreEditorSelection();

  const selection = window.getSelection();
  const selectedText = selection ? selection.toString() : "";
  const tagName = FORMAT_TAGS[format];
  if (!tagName) return;

  const activeNode = getActiveFormatNode(tagName);
  if (activeNode) {
    unwrapNode(activeNode);
    syncEditorState();
    return;
  }

  if (format === "link") {
    const url = window.prompt("Ссылка", "https://");
    if (!url) return;
    wrapSelection("a", { href: url }, selectedText || url);
  } else {
    wrapSelection(tagName, {}, selectedText || FORMAT_FALLBACKS[format]);
  }

  syncEditorState();
}

function wrapSelection(tagName, attributes, fallbackText) {
  const selection = window.getSelection();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const node = document.createElement(tagName);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));

  if (range && elements.bodyEditor.contains(range.commonAncestorContainer)) {
    const content = range.extractContents();
    node.appendChild(content.textContent ? content : document.createTextNode(fallbackText));
    range.insertNode(node);
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
    saveEditorSelection();
    return;
  }

  node.textContent = fallbackText;
  elements.bodyEditor.appendChild(node);
  const fallbackRange = document.createRange();
  fallbackRange.selectNodeContents(node);
  if (selection) {
    selection.removeAllRanges();
    selection.addRange(fallbackRange);
  }
  saveEditorSelection();
}

function getActiveFormatNode(tagName) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!elements.bodyEditor.contains(range.commonAncestorContainer)) return null;

  const startNode = closestFormatNode(range.startContainer, tagName);
  const endNode = closestFormatNode(range.endContainer, tagName);
  if (startNode && startNode === endNode) {
    return startNode;
  }
  return startNode || null;
}

function closestFormatNode(node, tagName) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (!element) return null;
  const candidate = element.closest(tagName);
  return candidate && elements.bodyEditor.contains(candidate) ? candidate : null;
}

function unwrapNode(node) {
  const parent = node.parentNode;
  if (!parent) return;

  const range = document.createRange();
  range.selectNodeContents(node);
  const fragment = range.extractContents();
  const firstChild = fragment.firstChild;
  const lastChild = fragment.lastChild;
  parent.insertBefore(fragment, node);
  parent.removeChild(node);

  if (firstChild && lastChild) {
    const selection = window.getSelection();
    const unwrappedRange = document.createRange();
    unwrappedRange.setStartBefore(firstChild);
    unwrappedRange.setEndAfter(lastChild);
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(unwrappedRange);
    }
    saveEditorSelection();
  }
  parent.normalize();
}

function rememberSelectionAndToolbar() {
  saveEditorSelection();
  updateToolbarState();
}

function syncEditorState() {
  state.body = elements.bodyEditor.innerHTML;
  markDirty();
  renderPreview();
  updateToolbarState();
}

function updateToolbarState() {
  const selection = window.getSelection();
  const isInsideEditor =
    selection &&
    selection.rangeCount > 0 &&
    elements.bodyEditor.contains(selection.getRangeAt(0).commonAncestorContainer);

  document.querySelectorAll(".tool-button").forEach((button) => {
    const format = button.dataset.format;
    const tagName = FORMAT_TAGS[format];
    button.classList.toggle("is-active", Boolean(isInsideEditor && tagName && getActiveFormatNode(tagName)));
  });
}

function saveEditorSelection() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  if (elements.bodyEditor.contains(range.commonAncestorContainer)) {
    savedEditorRange = range.cloneRange();
  }
}

function restoreEditorSelection() {
  if (!savedEditorRange) return;
  if (!elements.bodyEditor.contains(savedEditorRange.commonAncestorContainer)) return;

  const selection = window.getSelection();
  if (selection) {
    selection.removeAllRanges();
    selection.addRange(savedEditorRange);
  }
}

function setMediaType(type) {
  state.media.type = type;
  if (type === "none") {
    state.media.url = "";
    state.media.fileName = "";
    elements.mediaFileInput.value = "";
    elements.mediaUrlInput.value = "";
  }
  markDirty();
  renderAll();
}

function addInlineButton() {
  const title = elements.buttonTitleInput.value.trim();
  const url = elements.buttonUrlInput.value.trim();
  if (!title || !url) {
    showToast("У кнопки должны быть название и ссылка.");
    return;
  }
  state.buttons.push({ title, url });
  elements.buttonTitleInput.value = "";
  elements.buttonUrlInput.value = "";
  markDirty();
  renderButtons();
  renderPreview();
}

function moveButton(index, direction) {
  const target = index + direction;
  if (target < 0 || target >= state.buttons.length) return;
  const [button] = state.buttons.splice(index, 1);
  state.buttons.splice(target, 0, button);
  markDirty();
  renderButtons();
  renderPreview();
}

function removeButton(index) {
  state.buttons.splice(index, 1);
  markDirty();
  renderButtons();
  renderPreview();
}

async function copySource() {
  if (!state.sourceUrl) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(state.sourceUrl);
  }
  showToast("Источник скопирован.");
}

function requestAiAdaptation() {
  submitDraft("ai_adapt");
}

function resetDraft() {
  Object.assign(state, cloneDraft(emptyDraft));
  renderAll();
  showToast("Черновик очищен.");
}

function submitDraft(action) {
  state.title = elements.titleInput.value.trim();
  state.body = elements.bodyEditor.innerHTML;

  const payload = buildPayload(action);
  const sentToTelegram = sendWebAppData(payload);
  elements.saveState.textContent = sentToTelegram ? "Отправлено" : "Сохранено локально";

  if (sentToTelegram) {
    showToast(action === "ai_adapt" ? "Запрос ИИ отправлен." : "Изменения отправлены.");
  } else {
    showToast("Сохранено локально. В Telegram данные уйдут боту.");
  }
}

function buildPayload(action) {
  const payload = {
    type: "article_editor",
    action,
    title: state.title,
    text_final_html: sanitizeOutgoingHtml(state.body),
    media: {
      type: state.media.type,
      url: state.media.type === "url" ? state.media.url : "",
      file_name: state.media.fileName,
      spoiler: state.media.spoiler,
    },
    buttons: state.buttons.map((button, index) => ({
      title: button.title,
      url: button.url,
      sort_order: index,
    })),
  };

  if (state.articleId !== null && state.articleId !== "") {
    payload.article_id = state.articleId;
  }
  if (state.sourceUrl) {
    payload.source_url = state.sourceUrl;
  }
  return payload;
}

function renderAll() {
  elements.titleInput.value = state.title;
  elements.bodyEditor.innerHTML = state.body;
  elements.sourceLink.textContent = state.sourceUrl || "не задан";
  elements.sourceLink.href = state.sourceUrl || "#";
  elements.copySourceButton.disabled = !state.sourceUrl;
  elements.mediaSpoilerInput.checked = state.media.spoiler;
  elements.mediaUrlInput.value = state.media.url && state.media.type === "url" ? state.media.url : "";
  renderMedia();
  renderButtons();
  renderPreview();
}

function renderMedia() {
  document.querySelectorAll(".segment").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mediaType === state.media.type);
  });

  elements.mediaFileField.hidden = !["photo", "video"].includes(state.media.type);
  elements.mediaUrlField.hidden = state.media.type !== "url";

  const mediaHtml = getMediaPreviewHtml();
  elements.mediaPreview.innerHTML = mediaHtml || "<span>Медиа не выбрано</span>";
  elements.previewMedia.innerHTML = mediaHtml;
  elements.previewMedia.classList.toggle("has-media", Boolean(mediaHtml));
  elements.previewMedia.classList.toggle("has-spoiler", state.media.spoiler);
}

function getMediaPreviewHtml() {
  if (state.media.type === "photo" && state.media.url) {
    return `<img src="${escapeAttribute(state.media.url)}" alt="">`;
  }
  if (state.media.type === "video" && state.media.url) {
    return `<video src="${escapeAttribute(state.media.url)}" controls></video>`;
  }
  if (state.media.type === "url" && state.media.url) {
    return `<div class="media-url">${escapeHtml(state.media.url)}</div>`;
  }
  return "";
}

function renderButtons() {
  elements.buttonList.innerHTML = "";

  if (!state.buttons.length) {
    elements.buttonList.innerHTML = '<div class="empty-state">Кнопки публикации не добавлены</div>';
    return;
  }

  state.buttons.forEach((button, index) => {
    const row = document.createElement("div");
    row.className = "button-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(button.title)}</strong>
        <span>${escapeHtml(button.url)}</span>
      </div>
      <div class="button-row__actions">
        <button type="button" title="Выше" data-action="up">↑</button>
        <button type="button" title="Ниже" data-action="down">↓</button>
        <button type="button" title="Удалить" data-action="remove">×</button>
      </div>
    `;
    row.querySelector('[data-action="up"]').addEventListener("click", () => moveButton(index, -1));
    row.querySelector('[data-action="down"]').addEventListener("click", () => moveButton(index, 1));
    row.querySelector('[data-action="remove"]').addEventListener("click", () => removeButton(index));
    elements.buttonList.appendChild(row);
  });
}

function renderPreview() {
  elements.previewTitle.textContent = state.title || "Без заголовка";
  elements.previewBody.innerHTML = sanitizePreviewHtml(state.body);
  elements.previewSource.innerHTML = state.sourceUrl
    ? `Источник: <a href="${escapeAttribute(state.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(state.sourceUrl)}</a>`
    : "";
  elements.previewButtons.innerHTML = "";
  state.buttons.forEach((button) => {
    const link = document.createElement("a");
    link.href = button.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = button.title;
    elements.previewButtons.appendChild(link);
  });
}

function sanitizePreviewHtml(value) {
  const template = document.createElement("template");
  template.innerHTML = value;
  template.content.querySelectorAll("script, style, iframe, object, embed").forEach((node) => node.remove());
  template.content.querySelectorAll("*").forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      if (attribute.name.startsWith("on")) {
        node.removeAttribute(attribute.name);
      }
    });
  });
  return template.innerHTML;
}

function sanitizeOutgoingHtml(value) {
  return sanitizePreviewHtml(value).trim();
}

function markDirty() {
  elements.saveState.textContent = "Есть изменения";
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 2400);
}

function decodeDraft(value) {
  if (!value) return null;
  try {
    return decodeURIComponent(escape(window.atob(value)));
  } catch {
    return value;
  }
}

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function cloneDraft(value) {
  return JSON.parse(JSON.stringify(value));
}

function valueOr(value, fallback) {
  return value === undefined || value === null ? fallback : value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#039;");
}
