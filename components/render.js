import puppeteer from '../../../lib/puppeteer/puppeteer.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')

/**
 * 渲染 HTML 模板并截图
 * @param {string} tpl - 模板名（对应 resources/atlas/<tpl>.html）
 * @param {object} data - 模板数据
 * @param {object} opts - 可选参数
 * @returns {Promise<object>} segment.image 可用的图片对象
 */
export async function renderAtlas (tpl, data = {}, opts = {}) {
  const app = 'atlas'
  const imgType = opts.imgType || 'jpeg'

  // 资源路径（模板内通过 _res_path 引用 CSS/图片）
  data._res_path = `../../../../../plugins/Atlas-Plugin/resources/`

  // 模板文件路径
  data.tplFile = `./plugins/Atlas-Plugin/resources/${app}/${tpl}.html`

  // 缓存标识
  data.saveId = data.saveId || tpl

  data.imgType = imgType

  // 渲染截图
  return await puppeteer.screenshot(`Atlas-Plugin/${app}/${tpl}`, data)
}
