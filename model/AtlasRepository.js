/**
 * AtlasRepository — 图鉴记录的数据访问层
 *
 * 职责边界（Stage 11 审计确认，Stage 12 从 AtlasService 剥离）：
 * - 只负责「把一条记录读出来」：路径解析、记录读取与适配、补丁套用、记录缓存、图片解析
 * - **不感知索引与搜索**：不调用 ensureIndex()，不碰 mapCache / indexCache
 * - **不决定何时失效**：recordCache 的清空只由 AtlasService.reloadIndex() 调 resetRecordCache() 触发
 *
 * **单一数据源**：记录只来自 Hesperides 合成路径 `hes/<game>/<page>/<id>.json`，
 * 不再有旧后端的 `data/items/…` 读取通路；非合成路径一律视为不存在。
 *
 * 补丁逻辑仍留在 components/patch.js（applyDataPatch / patchImageUrl / imageGameFolder），
 * 本模块只是调用方——不把补丁实现吸进来。
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { applyDataPatch, patchImageUrl, imageGameFolder } from '../components/patch.js'
import {
  HES_PATH_PREFIX,
  readRawByPath,
  adaptToLegacyRecord,
  hesperidesRecordSignature
} from './HesperidesRepository.js'
import { HESPERIDES_DIR } from './Hesperides.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')
/** 旧图库根目录（图片尚未迁到 Hesperides，见 docs/数据源与后端.md 的图片缺口） */
const backendRoot = path.join(pluginRoot, 'tool/nanoka-atlas-backend/nanoka-atlas-backend')

/**
 * 记录缓存：相对路径 → { sig, record }（LRU，上限见 RECORD_CACHE_MAX）
 *
 * 一次查询会反复取同一条目（全文兜底的二次评分、详情页 + 兄弟形态），
 * 而 loadRecord 每次都要读盘 + JSON.parse；缓存按「路径 + 文件签名」判活，数据文件被替换即自愈。
 * 注意：缓存的是**套过补丁**的实例，补丁文件本身的改动仍需 reloadIndex() 才生效（与补丁缓存同口径）。
 * @type {Map<string, {sig: string, record: object}>}
 */
const recordCache = new Map()

/**
 * 记录缓存条数上限
 *
 * 单次全文兜底会遍历 500+ 条高优先级条目、怪物深索引一次读 600+ 条，
 * 无上限缓存会把整个图鉴（十万级条目）都留在内存里；300 条够覆盖热门角色及其武器/圣遗物。
 */
const RECORD_CACHE_MAX = 300

/**
 * 丢弃全部记录缓存
 *
 * 只由 AtlasService.reloadIndex() 调用（唯一生命周期失效入口）——
 * 数据文件被替换时缓存会靠签名自愈，补丁改动必须走这里才会重新套用。
 * @returns {void}
 */
export function resetRecordCache () {
  recordCache.clear()
}

/**
 * 是否为 Hesperides 合成路径（`hes/<game>/<page>/<id>.json`，不进磁盘）
 * @param {string} relativePath
 * @returns {boolean}
 */
export function isHesperidesPath (relativePath) {
  return typeof relativePath === 'string' && relativePath.startsWith(HES_PATH_PREFIX)
}

/**
 * 记录签名（大小 + 修改时间）：记录文件被替换后签名变化，缓存自愈
 * @param {string} relativePath - 合成路径 `hes/…`
 * @returns {string} 非合成路径或文件不可读时返回空串
 */
export function recordSignature (relativePath) {
  if (!isHesperidesPath(relativePath)) return ''
  return hesperidesRecordSignature(relativePath)
}

/**
 * 深冻结记录（诊断用，默认关闭）
 *
 * 置 `ATLAS_SCAN_FREEZE=1` 后，缓存里的记录实例会被冻结：ESM 严格模式下任何调用方写回
 * 都会立刻抛 TypeError。用于验证「记录实例可共享」这一前提，防止后续新增代码原地改 record
 * 而污染其他请求（复现脚本见 .dsh/explore/scan-record-freeze.mjs）
 * @param {*} obj
 * @returns {*} 同一对象
 */
function freezeForScan (obj) {
  if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) return obj
  Object.freeze(obj)
  for (const value of Object.values(obj)) freezeForScan(value)
  return obj
}

/**
 * 从记录的 `meta.images` 中解析主图 file:// URL
 * 优先选 downloaded 非 placeholder，兜底任意有 localPath 的
 *
 * 图片来源有两处：Hesperides 的 `images/<game>/…`（新）与旧后端的 `gallery/<game>/…`（迁移期），
 * 按 `localPath` 前缀分别拼到对应根目录。
 * @param {object} record — 完整记录对象
 * @returns {string} file:// URL，无图片时返回空串
 */
export function resolveRecordImage (record) {
  const images = record?.meta?.images
  if (!images || !Array.isArray(images) || !images.length) return ''
  const picked = images.find(item => item?.localPath && item.status === 'downloaded' && !item.placeholder)
    || images.find(item => item?.localPath)
  if (!picked) return ''
  // 插件图片补丁优先（补缺图 / 覆盖错图）；游戏目录优先取记录自身的 meta.gameId
  const patch = patchImageUrl(record?.meta?.gameId || imageGameFolder(picked, images), picked.originalValue)
  if (patch) return patch
  if (!picked.localPath) return ''
  // 产物里是 posix 相对路径；旧产物可能带 Windows 反斜杠，统一后再判前缀
  const localPath = String(picked.localPath).replace(/\\/g, '/')
  const root = localPath.startsWith('images/') ? HESPERIDES_DIR : backendRoot
  return pathToFileURL(path.join(root, localPath)).href
}

/**
 * 加载单条记录的原始内容（不套插件补丁；供补丁层做上游值比对）
 *
 * 返回**已适配成旧结构**的记录（`{ meta, content: { list, detail } }`）：补丁的
 * `_patch.upstream` 与键路径都按这个结构书写，比对口径必须一致。
 * @param {string} relativePath - 合成路径 `hes/…`
 * @returns {object|null} 非合成路径 / 记录不存在返回 null
 */
export function loadRawRecord (relativePath) {
  if (!isHesperidesPath(relativePath)) return null
  const raw = readRawByPath(relativePath)
  return raw ? adaptToLegacyRecord(relativePath, raw) : null
}

/**
 * 加载单条记录（套用 resources/patch 下的补丁，命中进程内缓存）
 * @param {string} relativePath - 合成路径 `hes/…`
 * @returns {object|null}
 */
export function loadRecord (relativePath) {
  const sig = recordSignature(relativePath)
  if (!sig) return null // 记录不存在（与 loadRawRecord 同口径返回 null）

  const hit = recordCache.get(relativePath)
  if (hit && hit.sig === sig) {
    // LRU：Map 迭代序即插入序，命中后挪到队尾
    recordCache.delete(relativePath)
    recordCache.set(relativePath, hit)
    return hit.record
  }

  const record = loadRawRecord(relativePath)
  if (!record) return null
  applyDataPatch(record, relativePath)
  if (process.env.ATLAS_SCAN_FREEZE) freezeForScan(record)

  recordCache.set(relativePath, { sig, record })
  if (recordCache.size > RECORD_CACHE_MAX) recordCache.delete(recordCache.keys().next().value)
  return record
}

export { backendRoot }
