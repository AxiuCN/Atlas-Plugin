/**
 * 角色名称提取（资料子视图用）
 * 技能名 / 命座名 / 服装列表，均无描述、含图标
 */
import { imgUrl, skillTag } from '../util.js'

/** 获取技能名称列表（无描述，含图标） */
export function getSkillNames (detail, gameId, images) {
  const names = []
  if (gameId === 'gi' && detail.skills && Array.isArray(detail.skills)) {
    detail.skills.forEach((s, i) => {
      names.push({ name: s.name, tag: skillTag(s.name, 'gi'), icon: imgUrl(images, `detail.skills.${i}.promote.0.icon`) })
    })
  } else if (gameId === 'hsr' && detail.skills && typeof detail.skills === 'object') {
    Object.entries(detail.skills).forEach(([key, s]) => {
      names.push({ name: s.name, tag: skillTag(s.type || s.type_name || '', 'hsr'), icon: imgUrl(images, `detail.skills.${key}.level.0.icon`) })
    })
  } else if (gameId === 'zzz' && detail.skill && typeof detail.skill === 'object') {
    const skillOrder = ['basic', 'dodge', 'special', 'chain', 'core']
    const skillLabels = { basic: '普通攻击', dodge: '闪避', special: '特殊技', chain: '连携技', core: '核心技' }
    for (const key of skillOrder) {
      const sk = detail.skill[key]
      if (!sk) continue
      const main = sk.description?.[0]
      names.push({ name: main?.name || sk.name || skillLabels[key] || key, tag: skillLabels[key] || key, icon: imgUrl(images, `detail.skill.${key}.icon`) })
    }
  }
  return names
}

/** 获取命之座名称列表（无描述，含图标） */
export function getConstellationNames (detail, gameId, images) {
  const names = []
  if (gameId === 'gi' && detail.constellations && Array.isArray(detail.constellations)) {
    detail.constellations.forEach((c, i) => names.push({ order: i + 1, name: c.name, icon: imgUrl(images, `detail.constellations.${i}.icon`) }))
  } else if (gameId === 'hsr' && detail.ranks && typeof detail.ranks === 'object') {
    Object.entries(detail.ranks)
      .filter(([k]) => /^\d+$/.test(k))
      .sort(([a], [b]) => Number(a) - Number(b))
      .forEach(([k, r]) => names.push({ order: Number(k), name: r.name, icon: imgUrl(images, `detail.ranks.${k}.icon`) }))
  } else if (gameId === 'zzz' && detail.talent && typeof detail.talent === 'object') {
    Object.entries(detail.talent)
      .filter(([k]) => /^\d+$/.test(k))
      .sort(([a], [b]) => Number(a) - Number(b))
      .forEach(([k, t]) => names.push({ order: Number(k), name: t.name, icon: imgUrl(images, `detail.talent.${k}.icon`) }))
  }
  return names
}

/** 获取服装列表 */
export function getOutfits (charaInfo, detail, gameId) {
  const outfits = []
  if (gameId === 'gi' && charaInfo?.costume && Array.isArray(charaInfo.costume)) {
    for (const c of charaInfo.costume) {
      outfits.push({ name: c.name, desc: c.desc || '' })
    }
  } else if (gameId === 'zzz' && detail.skin && typeof detail.skin === 'object') {
    for (const sk of Object.values(detail.skin)) {
      if (sk && sk.name) outfits.push({ name: sk.name, desc: sk.desc || '' })
    }
  } else if (gameId === 'hsr' && charaInfo?.skin_name) {
    outfits.push({ name: charaInfo.skin_name, desc: '' })
  }
  return outfits
}