const state = {
  models: [],
  references: [],
  activeTaskId: "",
  currentStatus: "",
  pollTimer: 0,
  lastRequest: null,
  tos: { configured: false, message: "" }
};

const els = {
  apiStatus: document.querySelector("#api-status"),
  historyButton: document.querySelector("#history-button"),
  historyModal: document.querySelector("#history-modal"),
  historyClose: document.querySelector("#history-close"),
  historyList: document.querySelector("#history-list"),
  historyTaskId: document.querySelector("#history-task-id"),
  historyImport: document.querySelector("#history-import"),
  refreshModels: document.querySelector("#refresh-models"),
  modelSelect: document.querySelector("#model-select"),
  serviceTier: document.querySelector("#service-tier"),
  prompt: document.querySelector("#prompt"),
  insertTemplate: document.querySelector("#insert-template"),
  referenceTokens: document.querySelector("#reference-tokens"),
  fileInput: document.querySelector("#file-input"),
  sourceUrl: document.querySelector("#source-url"),
  sourceKind: document.querySelector("#source-kind"),
  addSource: document.querySelector("#add-source"),
  referenceList: document.querySelector("#reference-list"),
  resolution: document.querySelector("#resolution"),
  ratio: document.querySelector("#ratio"),
  duration: document.querySelector("#duration"),
  frames: document.querySelector("#frames"),
  seed: document.querySelector("#seed"),
  expires: document.querySelector("#expires"),
  generateAudio: document.querySelector("#generate-audio"),
  watermark: document.querySelector("#watermark"),
  lastFrame: document.querySelector("#last-frame"),
  webSearch: document.querySelector("#web-search"),
  sendUnmentioned: document.querySelector("#send-unmentioned"),
  refreshBalance: document.querySelector("#refresh-balance"),
  balanceValue: document.querySelector("#balance-value"),
  estimateValue: document.querySelector("#estimate-value"),
  actualCostValue: document.querySelector("#actual-cost-value"),
  costNote: document.querySelector("#cost-note"),
  generate: document.querySelector("#generate"),
  formMessage: document.querySelector("#form-message"),
  pollNow: document.querySelector("#poll-now"),
  jobSubtitle: document.querySelector("#job-subtitle"),
  progressLabel: document.querySelector("#progress-label"),
  progressValue: document.querySelector("#progress-value"),
  progressBar: document.querySelector("#progress-bar"),
  progressNote: document.querySelector("#progress-note"),
  stage: document.querySelector(".stage"),
  resultVideo: document.querySelector("#result-video"),
  taskMeta: document.querySelector("#task-meta"),
  downloadActions: document.querySelector("#download-actions"),
  requestPreview: document.querySelector("#request-preview")
};

init();

async function init() {
  wireEvents();
  await checkHealth();
  await loadTosStatus();
  await loadModels();
  await loadBalance();
  renderReferences();
  updateCostEstimate();
}

function wireEvents() {
  els.refreshModels.addEventListener("click", loadModels);
  els.historyButton.addEventListener("click", openHistory);
  els.historyClose.addEventListener("click", closeHistory);
  els.historyModal.addEventListener("click", event => {
    if (event.target === els.historyModal) {
      closeHistory();
    }
  });
  els.historyImport.addEventListener("click", importHistoryTask);
  els.historyTaskId.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      importHistoryTask();
    }
  });
  els.modelSelect.addEventListener("change", () => {
    updateCostEstimate();
    updateScenarioHint();
  });
  els.duration.addEventListener("input", updateCostEstimate);
  els.frames.addEventListener("input", updateCostEstimate);
  els.sendUnmentioned.addEventListener("change", updateCostEstimate);
  els.prompt.addEventListener("input", updateCostEstimate);
  els.fileInput.addEventListener("change", handleFiles);
  els.addSource.addEventListener("click", addManualSource);
  els.insertTemplate.addEventListener("click", insertTemplate);
  els.refreshBalance.addEventListener("click", loadBalance);
  els.generate.addEventListener("click", submitGeneration);
  els.pollNow.addEventListener("click", () => pollTask(true));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !els.historyModal.hidden) {
      closeHistory(event);
    }
  });
}

async function checkHealth() {
  try {
    const data = await getJson("/api/health");
    els.apiStatus.textContent = data.hasApiKey ? "API Key 已就绪" : "缺少 ARK_API_KEY";
    els.apiStatus.classList.toggle("good", Boolean(data.hasApiKey));
    els.apiStatus.classList.toggle("bad", !data.hasApiKey);
  } catch (error) {
    els.apiStatus.textContent = "服务不可用";
    els.apiStatus.classList.add("bad");
  }
}

async function loadBalance() {
  if (!els.balanceValue) {
    return;
  }

  els.balanceValue.textContent = "查询中...";
  try {
    const data = await getJson("/api/balance");
    if (!data.configured) {
      els.balanceValue.textContent = "未配置";
      els.costNote.textContent = data.message || "余额查询需要配置费用中心授权。";
      return;
    }

    const balance = data.result?.AvailableBalance;
    els.balanceValue.textContent = balance != null ? `¥${balance}` : "未返回";
    els.costNote.textContent = "余额来自火山费用中心 QueryBalanceAcct。实际扣费以火山账单为准。";
  } catch (error) {
    els.balanceValue.textContent = "查询失败";
    els.costNote.textContent = error.message;
  }
}

async function loadTosStatus() {
  try {
    state.tos = await getJson("/api/tos/status");
    if (state.tos.configured) {
      setMessage(`TOS 已配置：本地参考视频会自动上传到 ${state.tos.bucket}，任务结束后清理。`);
    }
  } catch (error) {
    state.tos = { configured: false, message: error.message };
  }
}

async function openHistory() {
  els.historyModal.hidden = false;
  await loadHistory();
}

function closeHistory(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  els.historyModal.hidden = true;
}

async function loadHistory() {
  els.historyList.innerHTML = `<div class="history-item"><p class="history-item-prompt">正在读取历史任务...</p></div>`;
  try {
    const data = await getJson("/api/history");
    renderHistory(data.data || []);
  } catch (error) {
    els.historyList.innerHTML = `<div class="history-item"><p class="history-item-prompt">${escapeHtml(error.message)}</p></div>`;
  }
}

function renderHistory(tasks) {
  els.historyList.innerHTML = "";
  if (!tasks.length) {
    els.historyList.innerHTML = `<div class="history-item"><p class="history-item-prompt">还没有历史任务。提交一次生成后会自动记录。</p></div>`;
    return;
  }

  for (const task of tasks) {
    const item = document.createElement("article");
    item.className = "history-item";
    const status = task.status || task.result?.status || "unknown";
    const prompt = task.prompt || task.request?.content?.find?.(entry => entry.type === "text")?.text || "";
    item.innerHTML = `
      <div class="history-item-head">
        <div class="history-item-title">
          <strong>${escapeHtml(task.id)}</strong>
          <span>${escapeHtml(task.model || task.result?.model || "-")} · ${escapeHtml(formatDateTime(task.updatedAt || task.createdAt))}</span>
        </div>
        <span class="history-badge ${escapeHtml(status)}">${escapeHtml(status)}</span>
      </div>
      <p class="history-item-prompt">${escapeHtml(prompt || "无 prompt 记录")}</p>
    `;

    const actions = document.createElement("div");
    actions.className = "history-item-actions";
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "small-button";
    restore.textContent = "查看/继续轮询";
    restore.addEventListener("click", () => restoreTask(task.id));
    actions.append(restore);

    const videoUrl = task.result?.content?.video_url || task.output?.video_url || "";
    if (videoUrl) {
      const open = document.createElement("a");
      open.href = videoUrl;
      open.target = "_blank";
      open.rel = "noreferrer";
      open.textContent = "打开视频";
      open.className = "small-button";
      actions.append(open);
    }

    item.append(actions);
    els.historyList.append(item);
  }
}

async function importHistoryTask() {
  const taskId = els.historyTaskId.value.trim();
  if (!taskId) {
    setError("请输入任务 ID。");
    return;
  }

  els.historyImport.disabled = true;
  els.historyImport.textContent = "恢复中...";
  try {
    const data = await postJson("/api/history/import", { taskId });
    renderTask(data.result || {});
    state.activeTaskId = data.result?.id || taskId;
    els.pollNow.disabled = false;
    if (!terminalStatuses().has(data.result?.status)) {
      startPolling();
    }
    await loadHistory();
    setMessage("任务已恢复。");
  } catch (error) {
    setError(error.message);
  } finally {
    els.historyImport.disabled = false;
    els.historyImport.textContent = "恢复";
  }
}

async function restoreTask(taskId) {
  closeHistory();
  state.activeTaskId = taskId;
  els.pollNow.disabled = false;
  const task = await pollTask(true);
  if (!terminalStatuses().has(task?.status)) {
    startPolling();
  }
}

function terminalStatuses() {
  return new Set(["succeeded", "failed", "expired", "cancelled"]);
}

async function loadModels() {
  setMessage("正在获取模型列表...");
  els.modelSelect.innerHTML = `<option value="">加载中...</option>`;
  try {
    const data = await getJson("/api/models");
    state.models = data.data || [];
    els.modelSelect.innerHTML = "";

    if (!state.models.length) {
      els.modelSelect.innerHTML = `<option value="">没有找到视频相关模型</option>`;
      setMessage("没有从 /models 中找到 seed/video/dance/doubao 相关模型。");
      return;
    }

    for (const model of state.models) {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = `${model.id}${model.status ? ` (${model.status})` : ""}`;
      els.modelSelect.append(option);
    }
    updateCostEstimate();
    setMessage(`已加载 ${state.models.length} 个候选模型，较新的 Seedance 模型已排在前面。`);
  } catch (error) {
    els.modelSelect.innerHTML = `<option value="">模型加载失败</option>`;
    setError(error.message);
  }
}

async function handleFiles(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) {
    return;
  }

  setMessage(`正在读取 ${files.length} 个素材...`);
  for (const file of files) {
    const kind = file.type.startsWith("video/") ? "video" : "image";
    if (kind === "image" && file.size > 30 * 1024 * 1024) {
      setError(`${file.name} 超过 30 MB，建议改用公网 URL 或 asset://。`);
      continue;
    }
    if (kind === "video" && file.size > 50 * 1024 * 1024) {
      setError(`${file.name} 超过 50 MB，请改用公网视频 URL。`);
      continue;
    }

    if (kind === "video") {
      const reference = addReference({
        name: file.name,
        kind,
        url: "",
        previewUrl: URL.createObjectURL(file),
        role: "reference_video",
        local: true,
        needsWebUrl: true,
        uploadStatus: state.tos.configured ? "queued" : "manual-url-required",
        uploadMessage: state.tos.configured ? "等待上传到 TOS" : state.tos.message,
        size: file.size
      });
      uploadVideoReference(file, reference);
      continue;
    }

    const dataUrl = await readFileAsDataUrl(file);
    addReference({
      name: file.name,
      kind,
      url: dataUrl,
      previewUrl: URL.createObjectURL(file),
      role: kind === "image" ? "reference_image" : "reference_video",
      local: true,
      size: file.size
    });
  }

  event.target.value = "";
  setMessage("素材已添加。点击素材标签可插入 @图片1 / @视频1。");
}

function addManualSource() {
  const url = els.sourceUrl.value.trim();
  if (!url) {
    setError("请输入素材 URL 或 asset://。");
    return;
  }
  if (els.sourceKind.value === "video" && !/^https?:\/\//i.test(url)) {
    setError("参考视频必须使用公网 http(s) URL。方舟接口不接受本地视频或 asset:// 作为 reference_video。");
    return;
  }
  if (!/^https?:\/\//i.test(url) && !/^asset:\/\//i.test(url)) {
    setError("图片素材地址需要是 http(s):// 或 asset://。");
    return;
  }

  addReference({
    name: url.split("/").pop() || `${els.sourceKind.value}_${state.references.length + 1}`,
    kind: els.sourceKind.value,
    url,
    previewUrl: /^https?:\/\//i.test(url) ? url : "",
    role: els.sourceKind.value === "image" ? "reference_image" : "reference_video",
    local: false,
    size: 0
  });
  els.sourceUrl.value = "";
  setMessage("素材已添加。");
}

function addReference(reference) {
  const stored = {
    id: crypto.randomUUID(),
    ...reference
  };
  state.references.push(stored);
  assignReferenceHandles();
  renderReferences();
  updateCostEstimate();
  return stored;
}

async function uploadVideoReference(file, reference) {
  if (!state.tos.configured) {
    setError(state.tos.message || "TOS 未配置，请手动填写公网视频 URL。");
    renderReferences();
    return;
  }

  try {
    reference.uploadStatus = "reading";
    reference.uploadMessage = "正在读取本地视频...";
    renderReferences();

    const dataUrl = await readFileAsDataUrl(file);
    reference.uploadStatus = "uploading";
    reference.uploadMessage = "正在上传到 TOS...";
    renderReferences();

    const result = await postJson("/api/tos/upload-video", {
      fileName: file.name,
      contentType: file.type || "video/mp4",
      dataUrl
    });

    reference.url = result.url;
    reference.tosKey = result.key;
    reference.tosBucket = result.bucket;
    reference.tosCleanupAt = result.cleanupAt;
    reference.tosExpiresAt = result.expiresAt;
    reference.local = false;
    reference.needsWebUrl = false;
    reference.uploadStatus = "done";
    reference.uploadMessage = "已上传 TOS 公开临时对象，任务结束或到期后自动清理。";
    setMessage(`${reference.handle} 已上传到 TOS，可以直接生成。`);
  } catch (error) {
    reference.uploadStatus = "error";
    reference.uploadMessage = error.message;
    setError(`${reference.handle} 上传 TOS 失败：${error.message}`);
  } finally {
    renderReferences();
    updateCostEstimate();
  }
}

function renderReferences() {
  assignReferenceHandles();
  els.referenceTokens.innerHTML = "";
  els.referenceList.innerHTML = "";

  if (!state.references.length) {
    els.referenceTokens.innerHTML = `<span class="token">暂无素材</span>`;
    els.referenceList.innerHTML = "";
    return;
  }

  for (const reference of state.references) {
    const token = document.createElement("button");
    token.className = "token";
    token.type = "button";
    token.textContent = `@${reference.handle}`;
    token.addEventListener("click", () => insertAtCursor(`@${reference.handle} `));
    els.referenceTokens.append(token);

    const card = document.createElement("article");
    card.className = "reference-card";

    const preview = document.createElement("div");
    preview.className = "reference-preview";
    if (reference.kind === "image" && reference.previewUrl) {
      const img = document.createElement("img");
      img.src = reference.previewUrl;
      img.alt = reference.name;
      preview.append(img);
    } else if (reference.kind === "video" && reference.previewUrl) {
      const video = document.createElement("video");
      video.src = reference.previewUrl;
      video.muted = true;
      video.controls = true;
      preview.append(video);
    } else {
      preview.textContent = reference.kind === "video" ? "video asset" : "image asset";
    }

    const body = document.createElement("div");
    body.className = "reference-body";
    body.innerHTML = `
      <div class="reference-title">
        <strong title="${escapeHtml(reference.name)}">${escapeHtml(reference.name)}</strong>
        <span>${escapeHtml(reference.handle)}</span>
      </div>
    `;

    const role = document.createElement("select");
    if (reference.kind === "image") {
      role.innerHTML = `
        <option value="reference_image">参考图</option>
        <option value="first_frame">首帧</option>
        <option value="last_frame">尾帧</option>
      `;
    } else {
      role.innerHTML = `<option value="reference_video">参考视频</option>`;
    }
    role.value = reference.role;
    role.addEventListener("change", () => {
      reference.role = role.value;
      updateScenarioHint();
      updateCostEstimate();
    });

    if (reference.kind === "video") {
      const urlField = document.createElement("label");
      urlField.className = "field";
      urlField.innerHTML = `<span>公网视频 URL</span>`;
      const input = document.createElement("input");
      input.placeholder = "https://.../reference.mp4";
      input.value = reference.url || "";
      input.addEventListener("input", () => {
        reference.url = input.value.trim();
        updateCostEstimate();
      });
      urlField.append(input);
      body.append(urlField);
    }

    if (reference.uploadStatus || reference.tosKey) {
      const status = document.createElement("p");
      status.className = `upload-status ${reference.uploadStatus || "done"}`;
      const parts = [reference.uploadMessage || ""];
      if (reference.tosCleanupAt) {
        parts.push(`清理：${formatDateTime(reference.tosCleanupAt)}`);
      }
      status.textContent = parts.filter(Boolean).join(" · ");
      body.append(status);
    }

    const actions = document.createElement("div");
    actions.className = "reference-actions";
    const insert = document.createElement("button");
    insert.type = "button";
    insert.className = "small-button";
    insert.textContent = `插入 @${reference.handle}`;
    insert.addEventListener("click", () => insertAtCursor(`@${reference.handle} `));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger-button";
    remove.textContent = "×";
    remove.title = "删除素材";
    remove.addEventListener("click", () => {
      state.references = state.references.filter(item => item.id !== reference.id);
      if (reference.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(reference.previewUrl);
      }
      if (reference.tosKey) {
        deleteTosObject(reference.tosKey);
      }
      assignReferenceHandles();
      renderReferences();
      updateCostEstimate();
    });

    actions.append(insert, remove);
    body.append(role, actions);
    card.append(preview, body);
    els.referenceList.append(card);
  }

  updateScenarioHint();
  updateCostEstimate();
}

function assignReferenceHandles() {
  let imageIndex = 0;
  let videoIndex = 0;
  let audioIndex = 0;

  for (const reference of state.references) {
    if (reference.kind === "video") {
      videoIndex += 1;
      reference.handle = `视频${videoIndex}`;
    } else if (reference.kind === "audio") {
      audioIndex += 1;
      reference.handle = `音频${audioIndex}`;
    } else {
      imageIndex += 1;
      reference.handle = `图片${imageIndex}`;
    }
  }
}

function updateScenarioHint() {
  const roles = state.references.map(reference => reference.role);
  const usesFrameMode = roles.includes("first_frame") || roles.includes("last_frame");
  const usesReferenceMode = roles.includes("reference_image") || roles.includes("reference_video");

  if (usesFrameMode && usesReferenceMode) {
    setMessage("提示：官方文档说明首尾帧模式和多模态参考模式互斥，混用可能被 API 拒绝。");
    return;
  }

  if (shouldOmitResolutionForFastR2v(els.modelSelect.value, getSelectedReferences())) {
    setMessage("提示：Fast 模型在参考素材模式下会自动不传 resolution，避免 r2v 参数校验失败。");
  }
}

async function deleteTosObject(key) {
  try {
    await postJson("/api/tos/delete", { key });
  } catch (error) {
    console.warn("TOS cleanup failed", error);
  }
}

function updateCostEstimate() {
  if (!els.estimateValue) {
    return;
  }

  const model = els.modelSelect.value;
  if (!model) {
    els.estimateValue.textContent = "--";
    return;
  }

  const selectedReferences = getSelectedReferences();
  const pricing = getPricing(model, selectedReferences);
  if (!pricing) {
    els.estimateValue.textContent = "暂无内置单价";
    els.costNote.textContent = "当前只内置 Seedance 2.0 的粗略估算；完成后仍会显示 token 用量。";
    return;
  }

  const durationSeconds = getRequestedDurationSeconds();
  if (!durationSeconds) {
    els.estimateValue.textContent = "待结果";
    els.costNote.textContent = `${pricing.label}；智能时长或未填时长时，提交前无法估算。`;
    return;
  }

  const roughCost = durationSeconds * pricing.roughPerSecond;
  els.estimateValue.textContent = `约 ¥${formatMoney(roughCost)}`;
  els.costNote.textContent = `${pricing.label}；提交前按 ${durationSecondsText(durationSeconds)} 粗估，最终以任务 usage 和火山账单为准。`;
}

function getSelectedReferences() {
  const prompt = els.prompt.value.trim().toLowerCase();
  if (els.sendUnmentioned.checked) {
    return state.references;
  }
  if (!prompt) {
    return [];
  }

  return state.references.filter(reference => prompt.includes(`@${String(reference.handle || "").toLowerCase()}`));
}

function getPricing(model, references) {
  if (!/seedance-2-0/i.test(model)) {
    return null;
  }

  const hasVideoInput = references.some(reference => reference.kind === "video");
  const tokenPrice = hasVideoInput ? 28 : 46;
  return {
    tokenPrice,
    roughPerSecond: hasVideoInput ? 0.61 : 0.95,
    label: hasVideoInput
      ? "Seedance 2.0 含视频输入参考价 ¥28 / 百万 tokens"
      : "Seedance 2.0 非视频输入参考价 ¥46 / 百万 tokens"
  };
}

function getRequestedDurationSeconds() {
  const frames = numberOrBlank(els.frames.value);
  if (frames) {
    return frames / 24;
  }

  const duration = numberOrBlank(els.duration.value);
  if (!duration || duration < 0) {
    return null;
  }
  return duration;
}

function durationSecondsText(seconds) {
  return Number.isInteger(seconds) ? `${seconds} 秒` : `${seconds.toFixed(2)} 秒`;
}

function insertTemplate() {
  const template = "镜头语言：低角度缓慢推进，主体动作清晰；画面风格：电影感、自然光、真实纹理；节奏：开场建立环境，中段动作变化，结尾停留 1 秒。";
  insertAtCursor(template);
}

function insertAtCursor(text) {
  const start = els.prompt.selectionStart || 0;
  const end = els.prompt.selectionEnd || 0;
  const before = els.prompt.value.slice(0, start);
  const after = els.prompt.value.slice(end);
  els.prompt.value = `${before}${text}${after}`;
  els.prompt.focus();
  const next = start + text.length;
  els.prompt.setSelectionRange(next, next);
}

async function submitGeneration() {
  clearPolling();
  setMessage("");
  els.generate.disabled = true;
  els.generate.textContent = "提交中...";

  try {
    const payload = buildClientPayload();
    const data = await postJson("/api/generate", payload);
    const task = data.result || {};
    state.lastRequest = data.request || null;
    state.activeTaskId = task.id || task.task_id || task.data?.id || "";

    if (!state.activeTaskId) {
      throw new Error("任务已提交，但响应中没有找到任务 ID。");
    }

    els.pollNow.disabled = false;
    els.jobSubtitle.textContent = `任务 ${state.activeTaskId} 已提交，正在轮询。`;
    els.requestPreview.textContent = JSON.stringify(state.lastRequest, null, 2);
    renderTask(task);
    startPolling();
  } catch (error) {
    setError(error.message);
  } finally {
    els.generate.disabled = false;
    els.generate.textContent = "生成视频";
  }
}

function buildClientPayload() {
  const model = els.modelSelect.value;
  if (!model) {
    throw new Error("请先选择模型。");
  }

  const prompt = els.prompt.value.trim();
  if (!prompt && !state.references.length) {
    throw new Error("请输入 prompt 或添加参考素材。");
  }
  if (!prompt && state.references.length && !els.sendUnmentioned.checked) {
    throw new Error("没有 prompt 时，请勾选“发送全部已添加素材”，或在 prompt 中写 @图片1 / @视频1。");
  }

  const selectedReferences = getSelectedReferences();
  for (const reference of selectedReferences) {
    if (reference.kind === "video" && reference.uploadStatus && !reference.url) {
      throw new Error(`参考视频 @${reference.handle} 还没有可用 URL：${reference.uploadMessage || "TOS 上传未完成"}`);
    }
    if (reference.kind === "video" && !/^https?:\/\//i.test(reference.url || "")) {
      throw new Error(`参考视频 @${reference.handle} 需要填写公网 http(s) URL。本地视频只能预览，方舟无法访问你电脑里的文件。`);
    }
  }

  return {
    model,
    prompt,
    sendUnmentionedReferences: els.sendUnmentioned.checked,
    references: state.references.map(reference => ({
      handle: reference.handle,
      name: reference.name,
      kind: reference.kind,
      role: reference.role,
      url: reference.url,
      tosKey: reference.tosKey || "",
      tosBucket: reference.tosBucket || ""
    })),
    params: {
      service_tier: els.serviceTier.value || "",
      resolution: shouldOmitResolutionForFastR2v(model, selectedReferences) ? "" : els.resolution.value,
      ratio: els.ratio.value,
      duration: numberOrBlank(els.duration.value),
      frames: numberOrBlank(els.frames.value),
      seed: numberOrBlank(els.seed.value),
      execution_expires_after: numberOrBlank(els.expires.value),
      generate_audio: els.generateAudio.checked,
      watermark: els.watermark.checked,
      return_last_frame: els.lastFrame.checked,
      use_web_search: els.webSearch.checked
    }
  };
}

function shouldOmitResolutionForFastR2v(model, references) {
  if (!/doubao-seedance-2-0-fast/i.test(String(model || ""))) {
    return false;
  }

  return references.some(reference => {
    const role = String(reference.role || "");
    return role.startsWith("reference_") || reference.kind === "video" || reference.kind === "audio";
  });
}

function startPolling() {
  clearPolling();
  pollTask(false);
  state.pollTimer = window.setInterval(() => pollTask(false), 6500);
}

async function pollTask(manual) {
  if (!state.activeTaskId) {
    return;
  }

  try {
    if (manual) {
      setMessage("正在刷新任务状态...");
    }
    const data = await getJson(`/api/tasks/${encodeURIComponent(state.activeTaskId)}`);
    const task = data.result || {};
    renderTask(task);

    if (terminalStatuses().has(task.status)) {
      clearPolling();
    }
    return task;
  } catch (error) {
    setError(error.message);
    return null;
  }
}

function renderTask(task) {
  const status = task.status || "unknown";
  state.currentStatus = status;
  const content = task.content || {};
  const videoUrl = content.video_url || task.video_url || "";
  const lastFrameUrl = content.last_frame_url || "";

  els.jobSubtitle.textContent = task.id ? `任务 ${task.id} · ${status}` : `任务状态：${status}`;
  els.taskMeta.innerHTML = "";
  updateProgress(task);
  addMeta("状态", status);
  addMeta("模型", task.model || els.modelSelect.value || "-");
  addMeta("比例", task.ratio || "-");
  addMeta("分辨率", task.resolution || "-");
  addMeta("时长", task.duration != null ? `${task.duration}s` : task.frames ? `${task.frames} frames` : "-");
  addMeta("Token", task.usage?.total_tokens ?? "-");
  updateActualCost(task);

  if (task.error) {
    addMeta("错误", normalizeUserFacingError(task.error.message || task.error.code || JSON.stringify(task.error)));
  }

  els.downloadActions.innerHTML = "";
  if (videoUrl) {
    els.resultVideo.src = videoUrl;
    els.stage.classList.add("has-video");
    addDownload("下载视频", videoUrl, `${task.id || "ark-video"}.mp4`);
    addActionButton("作为参考视频", () => addGeneratedReference("video", videoUrl, task.id || "generated-video"));
    addActionButton("复制视频 URL", () => copyText(videoUrl, "视频 URL 已复制。"));
  }
  if (lastFrameUrl) {
    addDownload("下载尾帧", lastFrameUrl, `${task.id || "ark-video"}-last-frame.png`);
    addActionButton("尾帧作参考图", () => addGeneratedReference("image", lastFrameUrl, `${task.id || "generated"}-last-frame`));
  }

  if (status === "succeeded") {
    setMessage("生成完成，可以预览和下载。");
  } else if (status === "failed" || status === "expired" || status === "cancelled") {
    setError(task.error?.message || `任务结束：${status}`);
  } else {
    setMessage(`任务状态：${status}。`);
  }
}

function updateProgress(task) {
  const progress = computeProgress(task);
  els.progressLabel.textContent = progress.label;
  els.progressValue.textContent = `${progress.percent}%`;
  els.progressNote.textContent = progress.note;
  els.progressBar.style.width = `${progress.percent}%`;
  els.progressBar.classList.toggle("failed", ["failed", "expired", "cancelled"].includes(task.status));
  els.progressBar.classList.toggle("waiting", ["queued", "running"].includes(task.status));
}

function computeProgress(task) {
  const status = task.status || "unknown";
  const direct = firstNumber(task.progress, task.progress_percent, task.percent, task.process);
  if (direct != null) {
    return {
      percent: clamp(Math.round(direct > 1 ? direct : direct * 100), 0, 100),
      label: "进度",
      note: "来自接口返回的进度字段。"
    };
  }

  if (status === "succeeded") {
    return { percent: 100, label: "进度", note: "任务已完成。" };
  }
  if (["failed", "expired", "cancelled"].includes(status)) {
    return { percent: 100, label: "进度", note: `任务已结束：${status}。` };
  }
  if (status === "queued") {
    return { percent: 8, label: "估算进度", note: "官方查询接口未返回百分比；当前为排队状态估算。" };
  }
  if (status === "running") {
    const createdAt = getTaskStartMillis(task);
    const duration = Number(task.duration || numberOrBlank(els.duration.value) || 6);
    const expectedSeconds = clamp(70 + duration * 35, 140, 780);
    const elapsedSeconds = createdAt ? (Date.now() - createdAt) / 1000 : 0;
    const percent = clamp(Math.round(12 + (elapsedSeconds / expectedSeconds) * 83), 12, 95);
    return {
      percent,
      label: "估算进度",
      note: "官方 API 当前未返回官网同款百分比；这里按运行时长估算，完成后会变为 100%。"
    };
  }

  return { percent: 0, label: "进度", note: "等待提交任务。" };
}

function getTaskStartMillis(task) {
  if (task.created_at) {
    return Number(task.created_at) * 1000;
  }
  const created = Date.parse(task.createdAt || "");
  return Number.isNaN(created) ? 0 : created;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }
  return null;
}

function updateActualCost(task) {
  const tokens = task.usage?.total_tokens ?? task.usage?.completion_tokens;
  if (!tokens) {
    els.actualCostValue.textContent = task.status === "succeeded" ? "未返回 usage" : "等待结果";
    return;
  }

  const pricing = getPricing(task.model || els.modelSelect.value, getSelectedReferences());
  if (!pricing) {
    els.actualCostValue.textContent = `${tokens} tokens`;
    return;
  }

  const cost = tokens / 1_000_000 * pricing.tokenPrice;
  els.actualCostValue.textContent = `约 ¥${formatMoney(cost)}`;
  addMeta("估算费用", `¥${formatMoney(cost)}`);
}

function addMeta(label, value) {
  const item = document.createElement("div");
  item.className = "meta-item";
  item.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong>`;
  els.taskMeta.append(item);
}

function addDownload(label, url, filename) {
  const anchor = document.createElement("a");
  anchor.href = `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
  anchor.textContent = label;
  anchor.download = filename;
  els.downloadActions.append(anchor);
}

function addActionButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "small-button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  els.downloadActions.append(button);
}

function addGeneratedReference(kind, url, name) {
  addReference({
    name,
    kind,
    url,
    previewUrl: url,
    role: kind === "video" ? "reference_video" : "reference_image",
    local: false,
    size: 0
  });
  setMessage(kind === "video" ? "已加入参考视频，可在 prompt 中插入 @视频 标签。" : "已加入参考图，可在 prompt 中插入 @图片 标签。");
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    setMessage(message);
  } catch {
    setError("复制失败，请手动复制结果里的 URL。");
  }
}

function clearPolling() {
  if (state.pollTimer) {
    window.clearInterval(state.pollTimer);
    state.pollTimer = 0;
  }
}

async function getJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || `请求失败：${response.status}`);
  }
  return data;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || `请求失败：${response.status}`);
  }
  return data;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

function numberOrBlank(value) {
  if (value === "" || value == null) {
    return "";
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : "";
}

function formatMoney(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return value >= 10 ? value.toFixed(2) : value.toFixed(3).replace(/0$/, "");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function setMessage(message) {
  els.formMessage.textContent = message;
  els.formMessage.classList.remove("error");
}

function setError(message) {
  els.formMessage.textContent = normalizeUserFacingError(message);
  els.formMessage.classList.add("error");
}

function normalizeUserFacingError(message) {
  const text = String(message || "");
  if (/input video may contain real person/i.test(text)) {
    return [
      "参考视频被 Ark 安全策略拦截：输入视频可能包含真人。",
      "可以换成不含真人的视频；如果必须使用真人，请先在火山方舟“真人人像/可信素材库”完成授权和一致性校验，再使用对应的授权素材 Asset ID。",
      `Ark 原始错误：${text}`
    ].join("\n");
  }
  return text;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
