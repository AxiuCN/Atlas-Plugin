/**
 * 模板可编译回归：resources/atlas/*.html 必须能被 art-template 编译
 *
 * 起因：`codex.html` 里用 `{{* … *}}` 当注释，而 art-template 4.x **没有注释语法**，
 * 编译期直接抛 CompileError —— bot 侧的表现是整页渲染不出来，回一句「攻略渲染失败」，
 * 且不挑角色（所有角色都炸）。这类问题只要「编译一次」就能挡住，所以本套件不喂真实数据。
 *
 * 前置：art-template 由 bot 提供（插件本体不依赖它）。装不上就按套件约定跳过、不算失败。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pluginRoot, skip, checker } from './_helper.mjs'

let template
try {
  template = (await import('art-template')).default
} catch {
  skip('未安装 art-template（只有模板回归需要它，插件本体不依赖）')
}

const dir = path.join(pluginRoot, 'resources/atlas')
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html')).sort()
const sources = files.map(f => [f, fs.readFileSync(path.join(dir, f), 'utf8')])
const { check, finish } = checker()

console.log(`\n=== A. 模板编译（${files.length} 个）===`)
for (const [f, src] of sources) {
  let err = ''
  try {
    template.compile(src)
  } catch (e) {
    err = String(e.message).split('\n')[0]
  }
  check(`${f} 可编译`, !err, err)
}

console.log('\n=== B. 双花括号注释守卫（art-template 4.x 无注释语法，写了必然编译失败）===')
const offenders = sources.filter(([, src]) => /\{\{\*/.test(src)).map(([f]) => f)
check('resources/atlas 下没有 {{* 写法', offenders.length === 0, offenders.join('、'))

console.log('\n=== C. codex.html 用贴近真实的数据渲染一次 ===')
const codex = sources.find(([f]) => f === 'codex.html')
if (!codex) {
  check('存在 codex.html', false)
} else {
  const data = {
    _res_path: '',
    renderScale: 1,
    name: '测试角色',
    hero: null,
    guide: {
      chips: ['建议等级：90级', '定位：测试'],
      sections: [
        {
          type: 'weapon',
          badge: '1',
          title: '武器',
          displayTitle: '武器',
          rows: [{ label: '推荐', items: [{ text: '西风剑', sepAfter: '' }] }]
        },
        { type: 'team', badge: '6', title: '配队', displayTitle: '配队', empty: true }
      ]
    }
  }
  let html = ''
  let err = ''
  try {
    html = template.render(codex[1], data)
  } catch (e) {
    err = String(e.message).split('\n')[0]
  }
  check('渲染成功且无残留模板标记', !err && html.includes('武器') && !html.includes('{{'), err || '')
}

finish()
