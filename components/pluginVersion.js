/**
 * 版本号与版权行 — 参照 Axiu-Plugin `components/pluginVersion.js`
 *
 * 页脚第二行要写三处版本：云崽、插件、数据引擎（Hesperides）。
 * 框架名按 bot 根 `package.json` 的包名判定（TRSS-Yunzai / Yunzai-Bot）；
 * 版本号读不到时**不拼版本**，避免出现 `TRSS-Yunzai TRSS-Yunzai` 这类重复。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const botRoot = path.resolve(pluginRoot, '../..')

function readPkg (file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** 插件版本（插件自己的 package.json） */
const pluginPkg = readPkg(path.join(pluginRoot, 'package.json'))
export const pluginVersion = pluginPkg?.version || '1.0.0'

/** 云崽显示名与版本号（bot 根 package.json） */
const yunzaiPkg = readPkg(path.join(botRoot, 'package.json'))
export const yunzaiName = /trss/i.test(yunzaiPkg?.name || '') ? 'TRSS-Yunzai' : 'Yunzai-Bot'
export const yunzaiVersion = yunzaiPkg?.version || ''

/** 数据引擎版本（Hesperides 子模块 package.json） */
const hesperidesPkg = readPkg(path.join(pluginRoot, 'tool/Hesperides/Hesperides/package.json'))
export const hesperidesVersion = hesperidesPkg?.version || ''

const withVersion = (name, version) => (version
  ? `${name} <span class="version">${version}</span>`
  : name)

/**
 * 页脚第二行（HTML 片段，模板用 `{{@copyright}}` 注入）
 * @returns {string} `Created By TRSS-Yunzai <版本> & Atlas-Plugin <版本> & Hesperides <版本>`
 */
export function buildCopyright () {
  return [
    'Created By',
    withVersion(yunzaiName, yunzaiVersion),
    '&',
    withVersion('Atlas-Plugin', pluginVersion),
    '&',
    withVersion('Hesperides', hesperidesVersion)
  ].join(' ')
}

/** 纯文本版权行（聊天消息用，不带 HTML 标签） */
export function buildCopyrightText () {
  const withTextVersion = (name, version) => (version ? `${name} ${version}` : name)
  return `Created By ${withTextVersion(yunzaiName, yunzaiVersion)} & ${withTextVersion('Atlas-Plugin', pluginVersion)} & ${withTextVersion('Hesperides', hesperidesVersion)}`
}