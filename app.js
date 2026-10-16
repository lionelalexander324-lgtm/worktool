(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const refs = {
    fileInput: $('fileInput'), dropZone: $('dropZone'), fileState: $('fileState'), status: $('status'),
    formatBadge: $('formatBadge'), infoName: $('infoName'), infoSize: $('infoSize'), infoFrames: $('infoFrames'),
    infoFps: $('infoFps'), infoDuration: $('infoDuration'), frameSection: $('frameSection'), layoutSection: $('layoutSection'),
    exportSection: $('exportSection'), restoreFrame: $('restoreFrame'), recommendTitle: $('recommendTitle'),
    recommendText: $('recommendText'), frameSlider: $('frameSlider'), frameOutput: $('frameOutput'), prevFrame: $('prevFrame'),
    nextFrame: $('nextFrame'), playPause: $('playPause'), useFrame: $('useFrame'), sizeSelect: $('sizeSelect'),
    scaleSlider: $('scaleSlider'), scaleOutput: $('scaleOutput'), offsetX: $('offsetX'), offsetY: $('offsetY'),
    centerContent: $('centerContent'), autoFit: $('autoFit'), resetLayout: $('resetLayout'), fileName: $('fileName'),
    exportButton: $('exportButton'), toggleGrid: $('toggleGrid'), detailView: $('detailView'), previewStage: $('previewStage'),
    emptyPreview: $('emptyPreview'), canvasWrap: $('canvasWrap'), outputCanvas: $('outputCanvas'), loadingOverlay: $('loadingOverlay'),
    loadingText: $('loadingText'), previewSize: $('previewSize'), previewFrame: $('previewFrame'), previewMode: $('previewMode'),
    toast: $('toast'), rendererHost: $('rendererHost')
  };

  const state = {
    player: null, parser: null, video: null, file: null, objectUrl: null,
    width: 0, height: 0, frames: 0, fps: 0, currentFrame: 0, recommendedFrame: 0,
    frameMode: '自动推荐', playing: false, outputWidth: 0, outputHeight: 0,
    scale: 100, offsetX: 0, offsetY: 0, alphaBounds: null, loadToken: 0
  };
  const outCtx = refs.outputCanvas.getContext('2d', { alpha: true, willReadFrequently: true });
  let toastTimer = 0;

  function setStatus(message, type = '') {
    refs.status.className = `status${type ? ` is-${type}` : ''}`;
    refs.status.lastElementChild.textContent = message;
  }

  function toast(message, isError = false) {
    clearTimeout(toastTimer);
    refs.toast.textContent = message;
    refs.toast.className = `toast${isError ? ' is-error' : ''}`;
    refs.toast.hidden = false;
    toastTimer = setTimeout(() => { refs.toast.hidden = true; }, 3200);
  }

  function setLoading(show, message = '读取动画结构…') {
    refs.loadingText.textContent = message;
    refs.loadingOverlay.hidden = !show;
  }

  function setControlsEnabled(enabled) {
    [refs.frameSection, refs.layoutSection, refs.exportSection].forEach((el) => el.classList.toggle('is-disabled', !enabled));
    [refs.restoreFrame, refs.frameSlider, refs.prevFrame, refs.nextFrame, refs.playPause, refs.useFrame,
      refs.sizeSelect, refs.scaleSlider, refs.offsetX, refs.offsetY, refs.centerContent, refs.autoFit,
      refs.resetLayout, refs.fileName, refs.exportButton,
      ...document.querySelectorAll('[data-scale]')].forEach((el) => { el.disabled = !enabled; });
  }

  function baseName(name) {
    return name.replace(/\.svga$/i, '').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'svga';
  }

  function cleanFileName(value) {
    const stem = value.replace(/\.png$/i, '').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'thumbnail';
    return `${stem}.png`;
  }

  function nextPaint() {
    // Background WebViews can throttle requestAnimationFrame indefinitely.
    // SVGAPlayer renders stepToFrame synchronously, so yielding one task is enough.
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function waitUntilPrepared(player, token) {
    const started = performance.now();
    while (!player._renderer?._prepared) {
      if (token !== state.loadToken) throw new Error('已取消上一文件的解析');
      if (performance.now() - started > 12000) throw new Error('素材图片加载超时，请检查 SVGA 文件是否完整');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await nextPaint();
  }

  function parseVideo(file) {
    return new Promise((resolve, reject) => {
      try {
        const parser = new SVGA.Parser();
        state.parser = parser;
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) { settled = true; reject(new Error('解析超时，文件可能损坏或编码不受支持')); }
        }, 15000);
        parser.load(file, (video) => {
          if (settled) return;
          settled = true; clearTimeout(timer); resolve(video);
        }, (error) => {
          if (settled) return;
          settled = true; clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error || '未知解析错误')));
        });
      } catch (error) { reject(error); }
    });
  }

  async function handleFile(file) {
    if (!file) return;
    if (!/\.svga$/i.test(file.name)) {
      setStatus('文件格式不支持，请选择 .svga 文件', 'error');
      toast('请选择扩展名为 .svga 的文件', true);
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setStatus('文件超过 50 MB，可能无法稳定解析', 'error');
      toast('文件过大，请先优化素材后重试', true);
      return;
    }

    const token = ++state.loadToken;
    stopPlayback();
    setControlsEnabled(false);
    setLoading(true);
    setStatus('正在解析文件…', 'busy');
    refs.fileState.textContent = '解析中';
    refs.fileState.className = 'state-chip';

    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = URL.createObjectURL(file);
    state.file = file;

    try {
      const video = await parseVideo(file);
      if (token !== state.loadToken) return;
      if (!video || !video.videoSize || !video.frames || !video.FPS) throw new Error('缺少画布、帧数或帧率信息');

      state.video = video;
      state.width = Math.round(Number(video.videoSize.width));
      state.height = Math.round(Number(video.videoSize.height));
      state.frames = Math.max(1, Math.round(Number(video.frames)));
      state.fps = Math.max(1, Number(video.FPS));
      state.currentFrame = 0;
      state.scale = 100;
      state.offsetX = 0;
      state.offsetY = 0;
      state.outputWidth = state.width;
      state.outputHeight = state.height;

      refs.rendererHost.style.width = `${state.width}px`;
      refs.rendererHost.style.height = `${state.height}px`;
      refs.rendererHost.replaceChildren();
      const player = new SVGA.Player(refs.rendererHost);
      player.loops = 0;
      player.clearsAfterStop = false;
      player.setContentMode('AspectFit');
      player.setVideoItem(video);
      player.onFrame((frame) => {
        state.currentFrame = frame;
        updateFrameUI();
        renderOutput();
      });
      player.onFinished(() => stopPlayback());
      state.player = player;
      await waitUntilPrepared(player, token);

      updateFileInfo();
      setupCanvas();
      setLoading(true, state.frames > 1 ? '正在分析候选画面…' : '正在生成静态预览…');
      const best = state.frames === 1 ? 0 : await recommendFrame(token);
      if (token !== state.loadToken) return;
      state.recommendedFrame = best;
      state.currentFrame = best;
      state.frameMode = state.frames === 1 ? '静态单帧' : '自动推荐';
      player.stepToFrame(best, false);
      await nextPaint();
      state.alphaBounds = computeAlphaBounds();
      renderOutput();
      updateAllUI();
      setControlsEnabled(true);
      setLoading(false);
      refs.emptyPreview.hidden = true;
      refs.canvasWrap.hidden = false;
      refs.fileState.textContent = '已载入';
      refs.fileState.className = 'state-chip is-ready';
      refs.formatBadge.textContent = state.frames === 1 ? '静态 SVGA' : '动态 SVGA';
      refs.formatBadge.className = 'mini-badge is-ready';
      setStatus(state.frames === 1 ? '静态画面已生成，可直接导出' : `已推荐第 ${best + 1} 帧，可继续微调`, 'success');
    } catch (error) {
      console.error(error);
      setLoading(false);
      refs.fileState.textContent = '解析失败';
      refs.fileState.className = 'state-chip';
      const hint = location.protocol === 'file:' ? '请通过本地服务器打开工具后重试' : '文件可能损坏或包含当前浏览器不支持的编码';
      setStatus(`解析失败：${error?.message || '未知错误'}。${hint}`, 'error');
      toast('SVGA 解析失败，请检查文件后重试', true);
    }
  }

  function updateFileInfo() {
    refs.infoName.textContent = state.file.name;
    refs.infoName.title = state.file.name;
    refs.infoSize.textContent = `${state.width} × ${state.height}`;
    refs.infoFrames.textContent = `${state.frames} 帧`;
    refs.infoFps.textContent = `${state.fps.toFixed(state.fps % 1 ? 1 : 0)} FPS`;
    refs.infoDuration.textContent = `${(state.frames / state.fps).toFixed(2)} 秒`;
    refs.frameSlider.max = String(Math.max(0, state.frames - 1));
    refs.sizeSelect.value = 'original';
    refs.fileName.value = `${baseName(state.file.name)}_thumbnail.png`;
  }

  function setupCanvas() {
    refs.outputCanvas.width = state.outputWidth;
    refs.outputCanvas.height = state.outputHeight;
  }

  function sampleFrames() {
    if (state.frames <= 2) return Array.from({ length: state.frames }, (_, i) => i);
    const start = Math.floor((state.frames - 1) * .2);
    const end = Math.max(start, Math.floor((state.frames - 1) * .8));
    const count = Math.min(19, Math.max(7, end - start + 1));
    const values = new Set();
    for (let i = 0; i < count; i++) values.add(Math.round(start + ((end - start) * i) / Math.max(1, count - 1)));
    return [...values];
  }

  async function recommendFrame(token) {
    const scan = document.createElement('canvas');
    const maxSide = 180;
    const ratio = Math.min(maxSide / state.width, maxSide / state.height, 1);
    scan.width = Math.max(1, Math.round(state.width * ratio));
    scan.height = Math.max(1, Math.round(state.height * ratio));
    const ctx = scan.getContext('2d', { willReadFrequently: true });
    let best = { frame: Math.floor(state.frames * .45), score: -Infinity };
    const candidates = sampleFrames();

    for (let i = 0; i < candidates.length; i++) {
      if (token !== state.loadToken) throw new Error('分析已取消');
      const frame = candidates[i];
      refs.loadingText.textContent = `正在分析候选画面 ${i + 1} / ${candidates.length}`;
      state.player.stepToFrame(frame, false);
      await nextPaint();
      ctx.clearRect(0, 0, scan.width, scan.height);
      state.player.drawOnContext(ctx, 0, 0, scan.width, scan.height);
      let image;
      try { image = ctx.getImageData(0, 0, scan.width, scan.height); } catch { continue; }
      const metrics = alphaMetrics(image.data, scan.width, scan.height);
      const positionBias = 1 - Math.abs(frame / Math.max(1, state.frames - 1) - .48);
      const score = metrics.occupancy * 6 + metrics.bboxArea * 1.5 + metrics.meanAlpha * 1.2 + metrics.centered * 1.1 + positionBias * .22 - metrics.edgeTouch * .8;
      if (score > best.score) best = { frame, score };
    }
    return best.frame;
  }

  function alphaMetrics(data, width, height) {
    let count = 0, alphaSum = 0, minX = width, minY = height, maxX = -1, maxY = -1;
    let left = 0, right = 0, top = 0, bottom = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const alpha = data[(y * width + x) * 4 + 3];
        if (alpha > 18) {
          count++; alphaSum += alpha;
          minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          if (x < 2) left++; if (x >= width - 2) right++; if (y < 2) top++; if (y >= height - 2) bottom++;
        }
      }
    }
    if (!count) return { occupancy: 0, bboxArea: 0, meanAlpha: 0, centered: 0, edgeTouch: 1 };
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const centerX = (minX + maxX) / 2 / width, centerY = (minY + maxY) / 2 / height;
    const distance = Math.hypot(centerX - .5, centerY - .5) / .707;
    return {
      occupancy: count / (width * height), bboxArea: (bw * bh) / (width * height), meanAlpha: alphaSum / count / 255,
      centered: Math.max(0, 1 - distance), edgeTouch: Math.min(1, (left + right + top + bottom) / Math.max(1, (width + height) * 2 * .12))
    };
  }

  function computeAlphaBounds() {
    const source = state.player?._drawingCanvas;
    if (!source) return null;
    const maxSide = 360;
    const ratio = Math.min(maxSide / state.width, maxSide / state.height, 1);
    const scan = document.createElement('canvas');
    scan.width = Math.max(1, Math.round(state.width * ratio));
    scan.height = Math.max(1, Math.round(state.height * ratio));
    const ctx = scan.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, scan.width, scan.height);
    const data = ctx.getImageData(0, 0, scan.width, scan.height).data;
    let minX = scan.width, minY = scan.height, maxX = -1, maxY = -1;
    for (let y = 0; y < scan.height; y++) for (let x = 0; x < scan.width; x++) {
      if (data[(y * scan.width + x) * 4 + 3] > 18) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    }
    if (maxX < 0) return null;
    return { x: minX / ratio, y: minY / ratio, width: (maxX - minX + 1) / ratio, height: (maxY - minY + 1) / ratio };
  }

  function renderOutput() {
    if (!state.player || !state.video) return;
    const w = state.outputWidth, h = state.outputHeight;
    if (refs.outputCanvas.width !== w || refs.outputCanvas.height !== h) setupCanvas();
    outCtx.setTransform(1, 0, 0, 1, 0, 0);
    outCtx.clearRect(0, 0, w, h);
    const fit = Math.min(w / state.width, h / state.height);
    const scale = fit * state.scale / 100;
    const dw = state.width * scale, dh = state.height * scale;
    const x = (w - dw) / 2 + state.offsetX;
    const y = (h - dh) / 2 + state.offsetY;
    state.player.drawOnContext(outCtx, x, y, dw, dh);
  }

  async function goToFrame(frame, mode = '手动选择') {
    if (!state.player) return;
    stopPlayback();
    state.currentFrame = Math.max(0, Math.min(state.frames - 1, Math.round(frame)));
    state.frameMode = mode;
    state.player.stepToFrame(state.currentFrame, false);
    await nextPaint();
    state.alphaBounds = computeAlphaBounds();
    renderOutput();
    updateAllUI();
  }

  function updateFrameUI() {
    refs.frameSlider.value = String(state.currentFrame);
    refs.frameOutput.textContent = `${state.currentFrame + 1} / ${state.frames}`;
    refs.previewFrame.textContent = `第 ${state.currentFrame + 1} 帧`;
  }

  function updateAllUI() {
    updateFrameUI();
    refs.scaleSlider.value = String(Math.round(state.scale));
    refs.scaleOutput.textContent = `${Math.round(state.scale)}%`;
    refs.offsetX.value = String(Math.round(state.offsetX));
    refs.offsetY.value = String(Math.round(state.offsetY));
    refs.previewSize.textContent = `${state.outputWidth} × ${state.outputHeight}`;
    refs.previewMode.textContent = state.frameMode;
    refs.recommendTitle.textContent = state.frames === 1 ? '静态素材 · 唯一画面' : `推荐第 ${state.recommendedFrame + 1} 帧`;
    refs.recommendText.textContent = state.frames === 1 ? '无需选择帧，可直接调整构图' : '已避开开场空白并评估主体完整度';
    document.querySelectorAll('[data-scale]').forEach((button) => button.classList.toggle('is-active', Number(button.dataset.scale) === Math.round(state.scale)));
  }

  function startPlayback() {
    if (!state.player || state.frames <= 1) return;
    state.playing = true;
    refs.playPause.classList.add('is-playing');
    refs.playPause.querySelector('span').textContent = '暂停';
    state.player.stepToFrame(state.currentFrame, true);
  }

  function stopPlayback() {
    if (state.player) state.player.pauseAnimation();
    state.playing = false;
    refs.playPause.classList.remove('is-playing');
    refs.playPause.querySelector('span').textContent = '播放';
  }

  function changeOutputSize(value) {
    if (value === 'original') { state.outputWidth = state.width; state.outputHeight = state.height; }
    else { state.outputWidth = Number(value); state.outputHeight = Number(value); }
    state.offsetX = 0; state.offsetY = 0;
    setupCanvas(); renderOutput(); updateAllUI();
  }

  function autoFitContent() {
    const bounds = state.alphaBounds || computeAlphaBounds();
    if (!bounds) { toast('当前帧没有检测到可见主体', true); return; }
    const padding = .08;
    const desired = Math.min(state.outputWidth / (bounds.width * (1 + padding * 2)), state.outputHeight / (bounds.height * (1 + padding * 2)));
    const base = Math.min(state.outputWidth / state.width, state.outputHeight / state.height);
    state.scale = Math.max(25, Math.min(200, desired / base * 100));
    const actualScale = base * state.scale / 100;
    const subjectCenterX = (bounds.x + bounds.width / 2) * actualScale;
    const subjectCenterY = (bounds.y + bounds.height / 2) * actualScale;
    const drawnX = (state.outputWidth - state.width * actualScale) / 2;
    const drawnY = (state.outputHeight - state.height * actualScale) / 2;
    state.offsetX = state.outputWidth / 2 - (drawnX + subjectCenterX);
    state.offsetY = state.outputHeight / 2 - (drawnY + subjectCenterY);
    renderOutput(); updateAllUI(); toast('已根据当前帧主体自动适配画布');
  }

  function exportPng() {
    if (!state.video) return;
    renderOutput();
    refs.exportButton.disabled = true;
    refs.exportButton.lastChild.textContent = ' 正在导出…';
    refs.outputCanvas.toBlob((blob) => {
      refs.exportButton.disabled = false;
      refs.exportButton.lastChild.textContent = ' 导出透明 PNG';
      if (!blob) { toast('PNG 生成失败，请重试', true); return; }
      const name = cleanFileName(refs.fileName.value);
      refs.fileName.value = name;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`已成功导出 ${name}`, 'success');
      toast(`已导出 ${state.outputWidth} × ${state.outputHeight} 透明 PNG`);
    }, 'image/png');
  }

  refs.fileInput.addEventListener('change', (event) => handleFile(event.target.files?.[0]));
  ['dragenter', 'dragover'].forEach((type) => refs.dropZone.addEventListener(type, (event) => { event.preventDefault(); refs.dropZone.classList.add('is-dragging'); }));
  ['dragleave', 'drop'].forEach((type) => refs.dropZone.addEventListener(type, (event) => { event.preventDefault(); refs.dropZone.classList.remove('is-dragging'); }));
  refs.dropZone.addEventListener('drop', (event) => handleFile(event.dataTransfer?.files?.[0]));
  refs.frameSlider.addEventListener('input', () => goToFrame(Number(refs.frameSlider.value)));
  refs.prevFrame.addEventListener('click', () => goToFrame(state.currentFrame - 1));
  refs.nextFrame.addEventListener('click', () => goToFrame(state.currentFrame + 1));
  refs.playPause.addEventListener('click', () => state.playing ? stopPlayback() : startPlayback());
  refs.restoreFrame.addEventListener('click', () => goToFrame(state.recommendedFrame, state.frames === 1 ? '静态单帧' : '自动推荐'));
  refs.useFrame.addEventListener('click', () => { state.frameMode = state.currentFrame === state.recommendedFrame ? '自动推荐' : '手动确认'; updateAllUI(); toast(`已将第 ${state.currentFrame + 1} 帧设为缩略图`); });
  refs.sizeSelect.addEventListener('change', () => changeOutputSize(refs.sizeSelect.value));
  refs.scaleSlider.addEventListener('input', () => { state.scale = Number(refs.scaleSlider.value); renderOutput(); updateAllUI(); });
  document.querySelectorAll('[data-scale]').forEach((button) => button.addEventListener('click', () => { state.scale = Number(button.dataset.scale); renderOutput(); updateAllUI(); }));
  [refs.offsetX, refs.offsetY].forEach((input) => input.addEventListener('input', () => { state.offsetX = Number(refs.offsetX.value) || 0; state.offsetY = Number(refs.offsetY.value) || 0; renderOutput(); updateAllUI(); }));
  refs.centerContent.addEventListener('click', () => { state.offsetX = 0; state.offsetY = 0; renderOutput(); updateAllUI(); toast('内容已居中'); });
  refs.resetLayout.addEventListener('click', () => { state.scale = 100; state.offsetX = 0; state.offsetY = 0; renderOutput(); updateAllUI(); });
  refs.autoFit.addEventListener('click', autoFitContent);
  refs.exportButton.addEventListener('click', exportPng);
  refs.fileName.addEventListener('blur', () => { refs.fileName.value = cleanFileName(refs.fileName.value); });
  refs.toggleGrid.addEventListener('click', () => {
    const active = refs.previewStage.classList.toggle('checkerboard');
    refs.toggleGrid.classList.toggle('is-active', active); refs.toggleGrid.setAttribute('aria-pressed', String(active));
  });
  refs.detailView.addEventListener('click', () => {
    const active = refs.previewStage.classList.toggle('is-detail');
    refs.detailView.classList.toggle('is-active', active); refs.detailView.setAttribute('aria-pressed', String(active));
  });
  window.addEventListener('beforeunload', () => { if (state.objectUrl) URL.revokeObjectURL(state.objectUrl); });
})();
