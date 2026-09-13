/** 图鉴常量定义 */

// 前缀 → 游戏映射
export const PREFIX_GAME = {
  '#': 'gi',
  '*': 'hsr',
  '%': 'zzz'
}

// 游戏 ID → 中文名
export const GAME_NAMES = {
  gi: '原神',
  hsr: '星铁',
  zzz: '绝区零'
}

// 游戏 ID → folder 名（对应 data/items/ 下的目录）
export const GAME_FOLDERS = {
  gi: '原神',
  hsr: '星铁',
  zzz: '绝区零'
}

// 快捷入口/子视图后缀集合（atlasShortcut 正则与 atlasQuery 子视图解析共用）
// 三游戏子视图命名以原神为基准，此处额外收录各游戏独有叫法（星魂/影画/行迹/晋阶材料…），
// 玩家混着叫也能命中（如 #下的星魂 等同命座）——后缀不按游戏过滤
// 注意顺序：长后缀在前（"养成素材"需在"养成"/"素材"前匹配，"忆灵技"在"忆灵"前）
export const SHORTCUT_SUFFIXES = [
  // 倍率视图（技能/天赋倍率 — 全等级宽表，长后缀优先）
  '天赋倍率', '技能倍率', '倍率表', '倍率',
  '图鉴',
  // 素材类（原神 升级材料/养成素材，星铁 晋阶材料，绝区零 突破素材）
  '养成素材', '升级素材', '升级材料', '晋阶材料', '晋阶素材', '突破材料', '突破素材',
  // 技能类（星铁把天赋叫行迹，忆灵体系另有忆灵技/忆灵天赋）
  '天赋', '技能', '行迹', '忆灵技', '忆灵',
  // 命座类（星铁 星魂，绝区零 影画）
  '命座', '星魂', '影画',
  // 页面类型类（非子视图：剥离后缀并把搜索结果限定到对应页面类型）
  '圣遗物', '遗器', '驱动盘',
  '资料', '故事', '语音',
  '养成', '素材', '材料', '升级'
]

// 页面类型后缀 → pageKey（atlasQuery.parseSubView 使用）
// 这类后缀不改变子视图，只把搜索结果限定到对应页面类型（如 #绝缘之旗印圣遗物 → 圣遗物页）
export const PAGE_TYPE_SUFFIXES = {
  圣遗物: 'artifact',
  遗器: 'relicset',
  驱动盘: 'equipment'
}

// 子视图后缀 → subView 规范名（atlasQuery.parseSubView 使用）
// 同一 subView 收录三游戏各自叫法：星铁「星魂」、绝区零「影画」等同命座，星铁「行迹」「忆灵技」等同天赋/技能，
// 素材类另收「晋阶材料」「突破素材」等——玩家混着叫都能落到同一子视图
// 新增后缀必须在此登记，否则会落到 materials 兜底
export const SUFFIX_TO_SUBVIEW = {
  天赋: 'skills', 技能: 'skills', 行迹: 'skills', 忆灵技: 'skills', 忆灵: 'skills',
  天赋倍率: 'rates', 技能倍率: 'rates', 倍率表: 'rates', 倍率: 'rates',
  命座: 'constellations', 星魂: 'constellations', 影画: 'constellations',
  资料: 'profile',
  故事: 'stories', 语音: 'stories',
  养成: 'materials', 素材: 'materials', 材料: 'materials',
  升级素材: 'materials', 养成素材: 'materials', 升级材料: 'materials', 升级: 'materials',
  晋阶材料: 'materials', 晋阶素材: 'materials', 突破材料: 'materials', 突破素材: 'materials'
}

// 页面 pageKey → 中文标签（三游戏通用回退）
export const PAGE_LABELS = {
  // 通用
  character: '角色',
  weapon: '武器',
  monster: '敌人',
  item: '物品',
  'achievement/achievement': '成就',
  // 原神特有
  artifact: '圣遗物',
  gcg: '七圣召唤',
  furniture: '摆设',
  suite: '摆设套装',
  tower: '深境螺旋',
  leyline: '地脉异常',
  rolecombat: '幻想真境剧诗',
  // 星铁特有
  lightcone: '光锥',
  relicset: '遗器套装',
  maze_boss: '末日幻影',
  maze: '混沌回忆',
  maze_peak: '异相仲裁',
  maze_extra: '虚构叙事',
  // 绝区零特有
  equipment: '驱动盘',
  bangboo: '邦布',
  boss: '危局强袭战',
  shiyu: '式舆防卫战',
  simul: '作战影像回顾'
}

// 页面优先级权重（用于搜索评分，数值越高排名越前）
export const PAGE_PRIORITY = Object.freeze({
  // 角色/武器 — 最高优先级
  '角色': 240,
  '武器': 220,
  '光锥': 220,
  // 挑战类
  '深境螺旋': 200,
  '地脉异常': 200,
  '幻想真境剧诗': 200,
  '混沌回忆': 200,
  '末日幻影': 200,
  '虚构叙事': 200,
  '异相仲裁': 200,
  '式舆防卫战': 200,
  '危局强袭战': 200,
  // 套装/圣遗物
  '圣遗物': 210,
  '遗器套装': 210,
  '驱动盘': 210,
  // 其他
  '邦布': 120,
  '敌人': 110,
  '物品详情': 30,
  '物品': 20,
  '摆设': 10
  // 七圣召唤/摆设套装/作战影像回顾/成就 等不列 → 默认 0
})

// 特殊页面触发词（不受常规搜索覆盖，触发特殊逻辑）
export const SPECIAL_TRIGGERS = {
  gi: {
    '成就': { pageKey: 'achievement/achievement', type: 'page_list' },
    '深渊': { pageKey: 'tower', type: 'page_detail' },
    '深境螺旋': { pageKey: 'tower', type: 'page_detail' },
    '剧诗': { pageKey: 'rolecombat', type: 'page_detail' },
    '幻想真境剧诗': { pageKey: 'rolecombat', type: 'page_detail' }
  },
  hsr: {
    '成就': { pageKey: 'achievement/achievement', type: 'page_list' },
    '混沌': { pageKey: 'maze', type: 'page_detail' },
    '混沌回忆': { pageKey: 'maze', type: 'page_detail' },
    '末日': { pageKey: 'maze_boss', type: 'page_detail' },
    '末日幻影': { pageKey: 'maze_boss', type: 'page_detail' },
    '虚构': { pageKey: 'maze_extra', type: 'page_detail' },
    '虚构叙事': { pageKey: 'maze_extra', type: 'page_detail' }
  },
  zzz: {
    '成就': { pageKey: 'achievement/achievement', type: 'page_list' },
    '防卫战': { pageKey: 'shiyu', type: 'page_detail' },
    '式舆': { pageKey: 'shiyu', type: 'page_detail' },
    '危局': { pageKey: 'boss', type: 'page_detail' },
    '强袭': { pageKey: 'boss', type: 'page_detail' },
    '危局强袭战': { pageKey: 'boss', type: 'page_detail' }
  }
}

// 挑战类 pageKey 集合（对应挑战详情模板 challenge.html）
export const CHALLENGE_PAGE_KEYS = new Set([
  // 原神
  'tower',              // 深境螺旋
  'leyline',            // 地脉异常
  'rolecombat',         // 幻想真境剧诗
  // 星铁
  'maze',               // 混沌回忆
  'maze_boss',          // 末日幻影
  'maze_extra',         // 虚构叙事
  'maze_peak',          // 异相仲裁
  // 绝区零
  'shiyu',              // 式舆防卫战
  'boss'                // 危局强袭战
])

// 模板名常量
export const TEMPLATE = {
  DETAIL: 'detail',
  CHALLENGE: 'challenge',
  LIST: 'list',
  ACHIEVEMENT: 'achievement',
  ACHIEVEMENT_CATEGORY: 'achievement-category'
}

/* ===== 属性/命途中文映射 =====
 * 索引层（形态族变体命名）与 sections 层（角色 hero 展示）共用，
 * 放在常量层以避开 model → components/sections 的循环依赖
 */

/** 原神元素英文 → 中文 */
export const ELEMENT_CN = {
  Cryo: '冰', Pyro: '火', Hydro: '水', Electro: '雷',
  Anemo: '风', Geo: '岩', Dendro: '草'
}

/** 星铁属性英文 → 中文 */
export const HSR_DAMAGE_CN = {
  Physical: '物理', Fire: '火', Ice: '冰', Lightning: '雷', Thunder: '雷',
  Wind: '风', Quantum: '量子', Imaginary: '虚数'
}

/** 星铁命途 → 中文（含数据源职业码与官方命途名） */
export const HSR_PATH_CN = {
  Destruction: '毁灭', TheHunt: '巡猎', Erudition: '智识', Harmony: '同谐',
  Nihility: '虚无', Preservation: '存护', Abundance: '丰饶', Elation: '欢愉',
  Remembrance: '记忆',
  // 数据源 base_type 职业码
  Rogue: '巡猎', Warrior: '毁灭', Mage: '智识', Knight: '存护',
  Priest: '丰饶', Warlock: '虚无', Shaman: '同谐', Memory: '记忆'
}

/** 星铁满级等级（角色/光锥 80 级；满级属性 = 基础值 + (80-1) × 成长值） */
export const HSR_MAX_LEVEL = 80

/** 原神元素英文 → 中文（未知值原样返回） */
export function elementLabel (value) {
  return ELEMENT_CN[value] || value
}

/** 星铁属性/命途英文 → 中文（未知值原样返回） */
export function hsrLabel (value) {
  if (!value) return ''
  return HSR_DAMAGE_CN[value] || HSR_PATH_CN[value] || value
}

// Data 目录路径（相对于 submodule）
export const DATA_DIR = 'tool/nanoka-atlas-backend/nanoka-atlas-backend/data'

// 搜索结果上限
export const MAX_RESULTS = 30
