/**
 * 角色名称提取（资料子视图用）
 * 技能名 / 命座名 / 服装列表，均无描述、含图标
 */
import { imgUrl, galleryUrl, skillTag } from '../util.js'

/** 获取技能名称列表（无描述，含图标） */
export function getSkillNames (detail, gameId, images) {
  const names = []
  if (gameId === 'gi' && detail.skills && Array.isArray(detail.skills)) {
    detail.skills.forEach((s, i) => {
      names.push({ name: s.name, tag: skillTag(s.name, 'gi'), icon: imgUrl(images, `detail.skills.${i}.promote.0.icon`) })
    })
  } else if (gameId === 'hsr' && detail.skills && typeof detail.skills === 'object') {
    Object.entries(detail.skills)
      .filter(([, s]) => s.type !== 'MazeNormal')
      .forEach(([key, s]) => {
        names.push({ name: s.name, tag: s.type_name || skillTag(s.type || '', 'hsr'), icon: imgUrl(images, `detail.skills.${key}.level.0.icon`) })
      })
  } else if (gameId === 'zzz' && detail.skill && typeof detail.skill === 'object') {
    // 类别顺序与标签同技能段落；招式图标取自 desc 内嵌的 <IconMap>（fieldPath 定位），无则用类别默认图标
    const skillOrder = [['basic', '普通攻击'], ['dodge', '闪避'], ['special', '特殊技'], ['chain', '连携技'], ['assist', '支援技']]
    const fallbackIcon = { basic: 'Icon_Normal', dodge: 'Icon_Evade', special: 'IconRoleSkillKeySpecial', chain: 'Icon_QTE', assist: 'Icon_Switch' }
    for (const [key, label] of skillOrder) {
      const sk = detail.skill[key]
      if (!sk) continue
      const main = sk.description?.[0]
      const iconName = String(main?.desc || '').match(/<IconMap:([A-Za-z0-9_]+)>/)?.[1]
      names.push({
        name: main?.name || sk.name || label,
        tag: label,
        icon: imgUrl(images, `detail.skill.${key}.description.0.desc.IconMap.${iconName}`) || galleryUrl('zzz', fallbackIcon[key])
      })
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