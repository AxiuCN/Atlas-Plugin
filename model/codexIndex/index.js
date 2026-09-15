/**
 * 角色攻略数据索引（Character-Codex-Data）
 *
 * 攻略仓库以 git clone 方式落在 tool/Character-Codex-Data/Character-Codex-Data/，
 * 由 `#图鉴初始化` / `#图鉴更新` 的最后一个步骤拉取（见 model/AtlasUpdater.js 的 syncCodexRepo）。
 *
 * **本模块是攻略数据的唯一入口**：页面编排只调用这里，不直接读文件——
 * 攻略仓库的目录结构、字段名、多语言与图片路径解析全部收敛在本文件，
 * 后续适配（含仓库结构变更）只需改这里，不动 apps / modules 层。
 * 适配说明见《角色攻略接入指南》（维护者提供，不随仓库分发）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { CODEX_DIR } from '../AtlasUpdater.js'

/** 攻略仓库是否已拉取（以 .git 目录为准） */
export function isCodexReady () {
  return fs.existsSync(path.join(CODEX_DIR, '.git'))
}

/**
 * 列出攻略仓库根目录条目（不含 .git），供适配阶段探查仓库结构
 * @returns {Array<{name: string, isDirectory: boolean}>} 仓库未拉取时返回空数组
 */
export function listCodexEntries () {
  if (!isCodexReady()) return []
  try {
    return fs.readdirSync(CODEX_DIR, { withFileTypes: true })
      .filter(e => e.name !== '.git')
      .map(e => ({ name: e.name, isDirectory: e.isDirectory() }))
  } catch {
    return []
  }
}

/**
 * 取某个角色的攻略数据
 *
 * TODO(攻略接入)：按 Character-Codex-Data 的实际结构实现——
 *   ① 用别名系统把「图鉴条目名」归一到攻略仓库的键（见开发文档「别名」章，
 *      不要自建名字映射表）；
 *   ② 解析攻略正文/配装/词条/队伍等字段，返回给 modules/codexQuery.js 与 codex.html；
 *   ③ 图片走 file:// 绝对路径（与 itemIndex / monsterIndex 一致）。
 * @param {string} gameId - 'gi' | 'hsr' | 'zzz'
 * @param {string} name - 图鉴条目名（角色名）
 * @returns {object|null} 未接入 / 未命中一律返回 null（调用方按「暂无攻略」处理）
 */
export function getCharacterGuide (gameId, name) {
  return null
}
