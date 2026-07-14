/**
 * guoba/index.js — 锅巴配置界面
 *
 * 对应 defSet/config.yaml 模板变量:
 *   atlas_priority, atlas_renderScale,
 *   atlas_autoUpdate_enabled, atlas_autoUpdate_cron,
 *   atlas_notifyGroups
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = path.join(__dirname, '..')
const DEFSET_CONFIG_PATH = path.join(PLUGIN_DIR, 'defSet', 'config.yaml')
const CONFIG_PATH = path.join(PLUGIN_DIR, 'config', 'config.yaml')
const EXAMPLE_PATH = path.join(PLUGIN_DIR, 'config', 'config.yaml.example')

/** guoba field → defSet 模板变量名 */
const TEMPLATE_VARS = {
  priority: 'atlas_priority',
  renderScale: 'atlas_renderScale',
  'autoUpdate.enabled': 'atlas_autoUpdate_enabled',
  'autoUpdate.cron': 'atlas_autoUpdate_cron',
  notifyGroups: 'atlas_notifyGroups',
  notifyMode: 'atlas_notifyMode'
}

/** 默认值（模板变量替换时的兜底） */
const DEFAULTS = {
  atlas_priority: '10000',
  atlas_renderScale: '1.5',
  atlas_autoUpdate_enabled: 'true',
  atlas_autoUpdate_cron: '0 0 5 * * *',
  atlas_notifyGroups: '',
  atlas_notifyMode: 'all'
}

/**
 * 读取运行时配置
 * 优先级: config.yaml > config.yaml.example > 空对象
 */
function readConfig () {
  let file = null
  if (fs.existsSync(CONFIG_PATH)) {
    file = CONFIG_PATH
  } else if (fs.existsSync(EXAMPLE_PATH)) {
    file = EXAMPLE_PATH
  }
  if (!file) return {}
  try {
    return YAML.parse(fs.readFileSync(file, 'utf8')) || {}
  } catch (e) {
    logger?.error('[Atlas][锅巴] 解析配置失败:', e)
    return {}
  }
}

export function supportGuoba () {
  return {
    pluginInfo: {
      name: 'Atlas-Plugin',
      title: '图鉴插件',
      author: '@阿修Axiu',
      authorLink: 'https://github.com/AxiuCN',
      link: 'https://github.com/AxiuCN/Atlas-Plugin',
      isV3: true,
      isV2: false,
      description: '多游戏图鉴查询插件，支持原神/星穹铁道/绝区零关键词搜索、详情/列表渲染、数据管理',
      icon: 'mdi:book-open-page-variant',
      iconColor: '#d3bc8e'
    },
    configInfo: {
      schemas: [
        // ==================== 基础设置 ====================
        { label: '基础设置', component: 'SOFT_GROUP_BEGIN' },
        {
          field: 'priority',
          label: '优先级',
          helpMessage: '数字越小越先执行',
          bottomHelpMessage: '默认 10000，建议不低于 10000 避免干扰其他插件（如 miao-plugin）',
          component: 'InputNumber',
          required: true,
          componentProps: { min: 100, max: 99999, defaultValue: 10000 }
        },
        {
          field: 'renderScale',
          label: '渲染缩放',
          helpMessage: 'HTML 渲染时的缩放比例',
          bottomHelpMessage: '默认 1.5，越大图片越清晰但渲染越慢',
          component: 'InputNumber',
          required: true,
          componentProps: { min: 0.5, max: 3, step: 0.1, defaultValue: 1.5 }
        },

        // ==================== 自动更新 ====================
        { label: '自动更新', component: 'SOFT_GROUP_BEGIN' },
        {
          field: 'autoUpdate.enabled',
          label: '启用自动更新',
          helpMessage: '开启后每天定时增量更新图鉴数据',
          bottomHelpMessage: '仅已初始化时运行（需先执行 #图鉴初始化），完成后通知主人和配置群',
          component: 'Switch',
          required: true,
          componentProps: { defaultValue: true }
        },
        {
          field: 'autoUpdate.cron',
          label: '自动更新 cron',
          helpMessage: '定时更新的 cron 表达式（6 字段）',
          bottomHelpMessage: '格式：秒 分 时 日 月 周。默认 0 0 5 * * * = 每天凌晨 5:00',
          component: 'Input',
          required: true,
          componentProps: { placeholder: '0 0 5 * * *' }
        },

        // ==================== 通知设置 ====================
        { label: '通知设置', component: 'SOFT_GROUP_BEGIN' },
        {
          field: 'notifyGroups',
          label: '通知群聊',
          helpMessage: '更新完成后发送通知的目标群',
          bottomHelpMessage: '可多选，留空则仅通知主人',
          component: 'GSelectGroup',
          componentProps: { placeholder: '请选择群聊' }
        },
        {
          field: 'notifyMode',
          label: '通知模式',
          helpMessage: '选择通知的发送范围',
          bottomHelpMessage: '默认 all，通知全部主人及上方配置的群聊',
          component: 'Select',
          required: true,
          componentProps: {
            options: [
              { label: '全部通知（全部主人+群聊）', value: 'all' },
              { label: '仅通知全部主人', value: 'master_only' },
              { label: '仅通知第一位主人', value: 'first_master' }
            ]
          }
        }
      ],

      getConfigData () {
        const cfg = readConfig()
        const au = cfg.autoUpdate || {}
        return {
          priority: cfg.priority ?? 10000,
          renderScale: cfg.renderScale ?? 1.5,
          'autoUpdate.enabled': au.enabled ?? true,
          'autoUpdate.cron': au.cron ?? '0 0 5 * * *',
          notifyGroups: (cfg.notifyGroups || '')
            ? String(cfg.notifyGroups).split(/[,，\s]+/).filter(Boolean)
            : [],
          notifyMode: cfg.notifyMode || 'all'
        }
      },

      async setConfigData (data, { Result }) {
        try {
          // 读取 defSet 模板
          if (!fs.existsSync(DEFSET_CONFIG_PATH)) {
            return Result.error('模板文件 defSet/config.yaml 不存在')
          }
          let template = fs.readFileSync(DEFSET_CONFIG_PATH, 'utf8')

          // 替换每个模板变量
          for (const [field, varName] of Object.entries(TEMPLATE_VARS)) {
            let value = data[field]
            if (value === undefined || value === null || value === '') {
              value = DEFAULTS[varName] ?? ''
            }
            template = template.replace(
              new RegExp(`\\$\\{${varName}\\}`, 'g'),
              String(value)
            )
          }

          // 写入 config.yaml
          const configDir = path.join(PLUGIN_DIR, 'config')
          if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true })
          fs.writeFileSync(CONFIG_PATH, template, 'utf8')

          return Result.ok({}, '保存成功~')
        } catch (err) {
          logger?.error('[Atlas][锅巴] 保存配置失败:', err)
          return Result.error(`保存失败：${err.message}`)
        }
      }
    }
  }
}
