const ROLE_TERMS = [
  '角色',
  '人物',
  '人设',
  '女主',
  '男主',
  '女生',
  '男生',
  '少女',
  '少年',
  '主角',
  '配角',
  '角色卡',
  '三视图'
]

const CREATIVE_TERMS = ['设计', '创建', '新增', '生成', '绘制', '画', '制作', '做一个', '做一张']

const VISUAL_TERMS = ['场景', '海报', '分镜', '镜头', '图片', '插画', '概念图', '视觉']

const CONTINUATION_TERMS = ['再设计', '再来', '另一个', '另外一个', '再做', '新版本']

const REVISE_TERMS = [
  '修改',
  '调整',
  '改',
  '换',
  '改成',
  '换成',
  '变成',
  '更仙',
  '更柔',
  '更酷',
  '更漂亮',
  '优化造型',
  '优化角色'
]

const REGENERATE_TERMS = ['重新生成', '重新出图', '重绘', '再生成', '重新画']

const CANVAS_EDIT_TERMS = [
  '移动',
  '向左',
  '向右',
  '向上',
  '向下',
  '删除',
  '移除',
  '改名',
  '重命名',
  '连线',
  '连接',
  '断开',
  '对齐'
]

const ANALYZE_TERMS = ['分析', '评价', '评估', '审阅', '检查', '解释', '总结']

const TEXT_ONLY_TERMS = [
  '只输出文字',
  '只要文字',
  '只给方案',
  '文字方案',
  '先看看方向',
  '先看方向',
  '暂不生成',
  '不要生图',
  '不要创建草稿',
  '不要修改画布',
  '不修改画布',
  '不要生成素材',
  '不生成图片'
]

const PROMPT_EDIT_TERMS = ['提示词', 'prompt', '描述词']

function includesAny(text, terms) {
  return terms.some((term) => text.includes(term))
}

export function detectAgentRoute(content, skill = null) {
  const text = String(content || '').toLocaleLowerCase()
  const textOnly = includesAny(text, TEXT_ONLY_TERMS)
  const intentText = TEXT_ONLY_TERMS.reduce(
    (current, term) => current.replaceAll(term.toLocaleLowerCase(), ''),
    text
  )
  const skillText = [skill?.name, skill?.description, skill?.promptTemplate]
    .filter(Boolean)
    .join('\n')
    .toLocaleLowerCase()
  const isCreative = includesAny(text, CREATIVE_TERMS)
  const isExplicitCreate =
    text.includes('新增') ||
    /(?:设计|创建|生成|绘制|画|制作|做)\s*(?:一个|一位|一名|两个|两位|两名|\d+\s*(?:个|位|名))?\s*(?:角色|人物|女主|男主|少女|少年)/.test(
      text
    )
  const isContinuation = includesAny(text, CONTINUATION_TERMS)
  const isRevision = includesAny(intentText, REVISE_TERMS)
  const isRegenerate = includesAny(text, REGENERATE_TERMS)
  const isCanvasEdit =
    includesAny(text, CANVAS_EDIT_TERMS) ||
    (isRevision && includesAny(text, PROMPT_EDIT_TERMS) && !isRegenerate)
  const isAnalyze = includesAny(text, ANALYZE_TERMS)
  const skillIsRole = Boolean(skill) && includesAny(skillText, ROLE_TERMS)
  const skillIsVisual = Boolean(skill) && includesAny(skillText, VISUAL_TERMS)
  const explicitRoleRequest = includesAny(text, ROLE_TERMS)
  const action = isCanvasEdit
    ? 'canvas_edit'
    : isRegenerate
      ? 'regenerate'
      : isExplicitCreate
        ? 'create'
        : isRevision
          ? 'revise'
          : isAnalyze && !isCreative
            ? 'analyze'
            : isCreative || isContinuation
              ? 'create'
              : 'general'
  const roleDesign =
    !isCanvasEdit &&
    !isRegenerate &&
    ((explicitRoleRequest && (isCreative || isRevision || isAnalyze)) ||
      (skillIsRole && ['create', 'revise', 'analyze'].includes(action)))
  const visualDesign =
    !isCanvasEdit &&
    !isRegenerate &&
    (includesAny(text, VISUAL_TERMS) || skillIsVisual) &&
    (isCreative || isRevision || isAnalyze)

  if (isRegenerate) {
    return {
      intent: 'regenerate',
      subagent: null,
      shouldGenerate: true,
      textOnly: false,
      action: 'regenerate'
    }
  }

  if (roleDesign) {
    return {
      intent: 'role_design',
      subagent: 'role-design-agent',
      shouldGenerate: !textOnly && action !== 'analyze',
      textOnly: textOnly || action === 'analyze',
      action
    }
  }
  if (visualDesign) {
    return {
      intent: 'visual_design',
      subagent: 'visual-design-agent',
      shouldGenerate: !textOnly && action !== 'analyze',
      textOnly: textOnly || action === 'analyze',
      action
    }
  }
  return {
    intent: 'general',
    subagent: null,
    shouldGenerate: false,
    textOnly,
    action
  }
}
