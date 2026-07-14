import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadMap } from './AtlasService.js'
import { GAME_NAMES } from '../components/constants.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')
const dataDir = path.join(pluginRoot, 'tool/nanoka-atlas-backend/nanoka-atlas-backend/data')

/**
 * 获取成就分类索引
 * @param {string} gameId - gi/hsr/zzz
 * @returns {{ gameName: string, gameId: string, categories: Array, totalCategories: number, missingFiles: number }}
 */
export function getIndex (gameId) {
  const map = loadMap()
  const page = map.games?.[gameId]?.locales?.zh?.pages?.['achievement/achievement']

  if (!page) {
    return {
      gameName: GAME_NAMES[gameId],
      gameId,
      categories: [],
      totalCategories: 0,
      missingFiles: 0
    }
  }

  const categories = []
  let missingFiles = 0

  for (const [recordId, record] of Object.entries(page.records)) {
    const fullPath = path.join(dataDir, record.path)
    const onDisk = fs.existsSync(fullPath)
    let count = null

    if (onDisk) {
      try {
        const json = JSON.parse(fs.readFileSync(fullPath, 'utf8'))
        count = (json?.content?.list?.list || []).length
      } catch { /* 解析失败视为文件缺失 */ }
    }

    if (!onDisk) missingFiles++

    categories.push({
      name: record.name,
      rarity: record.rarity || '',
      recordId,
      onDisk,
      count
    })
  }

  return {
    gameName: GAME_NAMES[gameId],
    gameId,
    categories,
    totalCategories: categories.length,
    missingFiles
  }
}

/**
 * 获取某个成就分类的详情（全部成就条目）
 * @param {string} gameId
 * @param {string} categoryName - 分类名（精确匹配）
 * @returns {{ error?: string, filePath?: string, gameName?: string, categoryName?: string, achievements?: Array, total?: number }}
 */
export function getCategoryDetail (gameId, categoryName) {
  const map = loadMap()
  const page = map.games?.[gameId]?.locales?.zh?.pages?.['achievement/achievement']

  if (!page) return { error: 'page_missing' }

  // 精确匹配分类名
  const record = Object.values(page.records).find(r => r.name === categoryName)
  if (!record) return { error: 'category_not_found' }

  const fullPath = path.join(dataDir, record.path)
  if (!fs.existsSync(fullPath)) {
    return { error: 'data_missing', filePath: record.path }
  }

  let json
  try {
    json = JSON.parse(fs.readFileSync(fullPath, 'utf8'))
  } catch {
    return { error: 'data_missing', filePath: record.path }
  }

  const innerList = json?.content?.list?.list || []
  const achievements = innerList
    .filter(a => a.name)
    .map(a => ({
      name: a.name,
      desc: cleanAchievementDesc(a.desc),
      rarity: a.rarity || '',
      rarityLower: (a.rarity || '').toLowerCase(),
      rarityLabel: RARITY_LABELS[a.rarity] || '',
      isHidden: a.show_type !== 'VISIBLE'
    }))

  return {
    gameName: GAME_NAMES[gameId],
    categoryName,
    achievements,
    total: achievements.length
  }
}

/** 稀有度 → 中文标签 */
const RARITY_LABELS = {
  Low: '低',
  Mid: '中',
  High: '高'
}

/**
 * 清洗成就描述文本
 * - 去除 <unbreak> 标签
 * - #N[text] 占位符替换为 ?
 * - 去除 RUBY / TEXTJOIN 标记
 * - 去除其他 HTML 标签
 */
function cleanAchievementDesc (desc) {
  if (!desc) return ''
  return desc
    .replace(/<unbreak>/gi, '')
    .replace(/<\/unbreak>/gi, '')
    .replace(/#\d+\[[^\]]*\]/g, '?')
    .replace(/\\n/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\{RUBY_B#[^}]*\}/g, '')
    .replace(/\{RUBY_E#\}/g, '')
    .replace(/\{TEXTJOIN#[^}]*\}/g, '')
    .replace(/\{TEXTJOINRE#\}/g, '')
    .trim()
}
