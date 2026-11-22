/**
 * 溢出自动缩字号（实测驱动，纯缩小、不折行）
 *
 * 渲染器用 puppeteer 打开本地 HTML 再截图，页面脚本会在截图前执行，所以这里可以量完再改：
 *   ① 只处理可能溢出的元素（技能参数表里长度 > 4 字的文字段、精炼正文整块）；
 *   ② 读阶段一次性量完所有目标（一次布局），按 `可用宽 / 实际宽` 算缩放比；
 *   ③ 写阶段统一写 `font-size`（一次样式重算）；
 *   ④ 对仍超宽的元素逐档下压，直到放下或触到下限。
 *
 * 下限 0.6（参数段 21px → ≈12.6px，精炼正文 24px → ≈14.4px）：再小就没法看了，
 * 到下限仍溢出就保持原样，不裁字、不隐藏。
 */
(function () {
  const MIN_SCALE = 0.6
  const MIN_TEXT_LENGTH = 5
  /** 纯数值段永远不缩（83.6% / 1,234），它们不是溢出源 */
  const PURE_NUMBER = /^[\d.,+\-/%]+$/
  /** 轻微超宽（< 1px）不处理，避免无意义的亚像素缩字 */
  const OVERFLOW_EPSILON = 1

  /** 元素可用宽度：表格内取单元格内容宽，块级取自身内容宽 */
  function availableWidth (el, isBlock) {
    if (isBlock) return el.clientWidth
    const box = el.closest('td') || el.parentElement || el
    const style = window.getComputedStyle(box)
    const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
    return Math.max(0, box.clientWidth - padding)
  }

  /** 元素实际宽度：块级看 scrollWidth（横向溢出量），内联块看自身宽度 */
  function actualWidth (el, isBlock) {
    return isBlock ? el.scrollWidth : el.getBoundingClientRect().width
  }

  function collect () {
    const targets = []
    for (const el of document.querySelectorAll('[data-fit]')) {
      const isBlock = el.classList.contains('refine-desc')
      const text = (el.textContent || '').trim()
      if (!isBlock && (text.length < MIN_TEXT_LENGTH || PURE_NUMBER.test(text))) continue
      targets.push({ el, isBlock, text })
    }
    return targets
  }

  function run () {
    // 读阶段：按「所在单元格」分组，一次布局量完
    // 同一格里可能有多个文字段（`攻击力` + `技能伤害`），统一取最狠的缩放比，避免一格内字号花掉
    const groups = new Map()
    for (const { el, isBlock } of collect()) {
      const available = availableWidth(el, isBlock)
      if (!available) continue
      const actual = actualWidth(el, isBlock)
      if (actual <= available + OVERFLOW_EPSILON) continue
      // 0.98 的余量吸收字体度量取整
      const scale = Math.max(MIN_SCALE, Math.min(1, (available / actual) * 0.98))
      const cell = isBlock ? el : (el.closest('td') || el.parentElement || el)
      const group = groups.get(cell) || { scale: 1, els: [] }
      group.scale = Math.min(group.scale, scale)
      group.els.push(el)
      groups.set(cell, group)
    }
    if (!groups.size) return

    // 写阶段：同一单元格统一一个缩放比
    for (const { scale, els } of groups.values()) {
      for (const el of els) el.style.fontSize = `${(scale * 100).toFixed(1)}%`
    }
  }

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(run)
  else window.addEventListener('load', run)
})()