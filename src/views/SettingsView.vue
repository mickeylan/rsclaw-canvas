<template>
  <section class="page settings" :class="{ 'settings--embedded': embedded }">
    <header class="page__header">
      <div>
        <h1 v-if="!embedded" class="page__title">设置</h1>
        <p class="page__subtitle">API Key 直接保存在当前设备的供应商配置中。</p>
      </div>
      <button
        v-if="activeSection === 'providers'"
        class="primary-button"
        type="button"
        @click="startCreate"
      >
        <PlusOutlined />
        添加供应商
      </button>
      <button
        v-else-if="activeSection === 'skills'"
        class="primary-button"
        type="button"
        @click="startCreateSkill"
      >
        <PlusOutlined />
        添加 Skill
      </button>
    </header>

    <div class="settings__layout">
      <aside class="settings__nav">
        <button
          class="settings__nav-item"
          :class="{ 'settings__nav-item--active': activeSection === 'skills' }"
          type="button"
          @click="activeSection = 'skills'"
        >
          <ThunderboltOutlined />
          本地 Skills
        </button>
        <button
          class="settings__nav-item"
          :class="{ 'settings__nav-item--active': activeSection === 'providers' }"
          type="button"
          @click="activeSection = 'providers'"
        >
          <ApiOutlined />
          AI 供应商
        </button>
      </aside>

      <div v-if="activeSection === 'providers'" class="settings__content">
        <div v-if="loading" class="empty-panel"><a-spin /></div>
        <div v-else-if="!providers.length" class="empty-panel">
          <div>
            <ApiOutlined class="settings__empty-icon" />
            <h2>还没有 AI 供应商</h2>
            <p>添加供应商后，就可以为画布助手和生成节点选择模型。</p>
            <button class="primary-button" type="button" @click="startCreate">添加供应商</button>
          </div>
        </div>

        <div v-else class="provider-list">
          <article v-for="provider in providers" :key="provider.id" class="provider-card">
            <div class="provider-card__icon">{{ providerInitial(provider) }}</div>
            <div class="provider-card__copy">
              <div class="provider-card__title">
                <strong>{{ provider.name }}</strong>
                <span
                  v-if="!provider.isBuiltin"
                  :class="{ 'provider-card__status--disabled': !provider.enabled }"
                >
                  {{ provider.enabled ? '已启用' : '已停用' }}
                </span>
              </div>
              <p>{{ provider.providerType }} · {{ provider.baseUrl || '默认地址' }}</p>
              <small>{{ provider.hasApiKey ? '密钥已填写' : '尚未配置密钥' }}</small>
              <div v-if="providerModelGroups(provider).length" class="provider-card__models">
                <span v-for="group in providerModelGroups(provider)" :key="group.type">
                  {{ group.label }} {{ group.count }}
                </span>
              </div>
              <small v-else class="provider-card__no-model">尚未配置模型</small>
              <small
                v-if="testResults[provider.id]"
                class="provider-card__test-result"
                :class="{ 'provider-card__test-result--error': !testResults[provider.id].ok }"
              >
                {{ testResults[provider.id].message }}
              </small>
            </div>
            <button
              class="secondary-button"
              type="button"
              :disabled="testingId === provider.id"
              @click="testConnection(provider)"
            >
              {{ testingId === provider.id ? '测试中…' : '测试连接' }}
            </button>
            <button class="secondary-button" type="button" @click="startEdit(provider)">
              {{ provider.isBuiltin ? '配置' : '编辑' }}
            </button>
            <button
              v-if="!provider.isBuiltin"
              class="icon-button provider-card__delete"
              type="button"
              title="删除供应商"
              :aria-label="`删除供应商 ${provider.name}`"
              :disabled="deletingId === provider.id"
              @click="removeProvider(provider)"
            >
              <DeleteOutlined />
            </button>
          </article>
        </div>
      </div>

      <div v-else class="settings__content">
        <div class="settings__section-head">
          <div>
            <h2>本地 AI Skills</h2>
            <p>Skill 保存在当前设备，只用于指导 AI 助手处理本次请求。</p>
          </div>
        </div>
        <section class="skill-group">
          <div class="skill-group__head">
            <div>
              <h3>系统 Skills</h3>
              <p>由 rsclaw-canvas 提供，规则内容受保护且不可修改。</p>
            </div>
            <span v-if="runtimeCapabilities.systemSkillDeveloperMode" class="skill-dev-badge">
              开发模式
            </span>
          </div>
          <div class="skill-list">
            <article
              v-for="skill in systemSkills"
              :key="skill.id"
              class="skill-card skill-card--system"
            >
              <div class="skill-card__badge skill-card__badge--system"><LockOutlined /></div>
              <div class="skill-card__copy">
                <div>
                  <strong>{{ skill.name }}</strong>
                  <span>系统 · 已启用</span>
                </div>
                <p>{{ skill.description || '未填写说明' }}</p>
              </div>
              <button
                v-if="runtimeCapabilities.systemSkillDeveloperMode"
                class="secondary-button"
                type="button"
                @click="startEditSkill(skill)"
              >
                查看与编辑
              </button>
            </article>
          </div>
        </section>

        <section class="skill-group">
          <div class="skill-group__head">
            <div>
              <h3>自定义 Skills</h3>
              <p>保存在当前设备，可自由编辑、停用或删除。</p>
            </div>
          </div>
          <div v-if="!customSkills.length" class="empty-panel empty-panel--compact">
            <div>
              <ThunderboltOutlined class="settings__empty-icon" />
              <h2>还没有自定义 Skill</h2>
              <p>添加一条生成规则，让助手稳定复用你的创作方法。</p>
            </div>
          </div>
          <div v-else class="skill-list">
            <article v-for="skill in customSkills" :key="skill.id" class="skill-card">
              <div class="skill-card__badge"><ThunderboltOutlined /></div>
              <div class="skill-card__copy">
                <div>
                  <strong>{{ skill.name }}</strong>
                  <span :class="{ 'provider-card__status--disabled': !skill.enabled }">
                    自定义 · {{ skill.enabled ? '已启用' : '已停用' }}
                  </span>
                </div>
                <p>{{ skill.description || '未填写说明' }}</p>
              </div>
              <button class="secondary-button" type="button" @click="startEditSkill(skill)">
                编辑
              </button>
              <button
                class="icon-button provider-card__delete"
                type="button"
                @click="removeSkill(skill)"
              >
                <DeleteOutlined />
              </button>
            </article>
          </div>
        </section>
      </div>
    </div>

    <a-modal
      v-model:open="editorOpen"
      :title="form.isBuiltin ? `配置 ${form.name}` : form.id ? '编辑 AI 供应商' : '添加 AI 供应商'"
      :confirm-loading="saving"
      width="860px"
      ok-text="保存配置"
      cancel-text="取消"
      @ok="saveProvider"
    >
      <div class="provider-form">
        <div v-if="form.isBuiltin" class="builtin-provider-summary">
          <LockOutlined />
          <div>
            <strong>系统内置供应商</strong>
            <p>名称、供应商类型、服务地址和启用状态由系统维护。</p>
            <dl>
              <div>
                <dt>供应商</dt>
                <dd>{{ form.name }}</dd>
              </div>
              <div>
                <dt>服务地址</dt>
                <dd>{{ form.baseUrl }}</dd>
              </div>
              <div>
                <dt>官方网站</dt>
                <dd>
                  <button
                    class="builtin-provider-summary__link"
                    type="button"
                    :title="`使用默认浏览器打开 ${form.officialUrl}`"
                    @click="openProviderOfficialWebsite"
                  >
                    <span>{{ form.officialUrl }}</span>
                    <ExportOutlined />
                  </button>
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <div v-else class="provider-form__custom-fields">
          <div class="field">
            <label>配置名称</label>
            <input v-model="form.name" maxlength="60" placeholder="例如：我的供应商" />
          </div>

          <div class="field">
            <label>供应商类型</label>
            <select v-model="form.providerType" @change="applyProviderDefault">
              <option value="openai-compatible">OpenAI 兼容接口</option>
              <option value="ark">火山方舟 Ark</option>
              <option value="apimart">APIMart</option>
              <option value="minimax">MiniMax</option>
              <option value="ollama">Ollama</option>
            </select>
          </div>

          <div class="field">
            <label>Base URL</label>
            <input v-model="form.baseUrl" placeholder="https://api.example.com" />
          </div>
        </div>

        <div class="field">
          <label>API Key</label>
          <input
            v-model="form.apiKey"
            type="password"
            autocomplete="off"
            placeholder="输入 API Key"
          />
        </div>

        <section class="provider-models">
          <div class="provider-models__head">
            <div>
              <strong>供应商模型</strong>
              <p>模型 ID 需与接口一致，画布节点会按模型类型自动筛选。</p>
            </div>
            <button class="secondary-button" type="button" @click="addModel()">
              <PlusOutlined />
              添加模型
            </button>
          </div>

          <div v-if="!form.models.length" class="provider-models__empty">
            暂无模型；保存后该供应商不会出现在任何类型的节点中。
          </div>
          <div v-else class="provider-models__list">
            <div
              v-for="(model, index) in form.models"
              :key="model.rowKey"
              class="provider-model-card"
            >
              <div class="provider-model-row">
                <div class="field provider-model-row__type">
                  <label :for="`model-type-${model.rowKey}`">类型</label>
                  <select
                    :id="`model-type-${model.rowKey}`"
                    v-model="model.modelType"
                    @change="handleModelTypeChange(model)"
                  >
                    <option
                      v-for="item in modelTypesForProvider(form.providerType)"
                      :key="item.value"
                      :value="item.value"
                    >
                      {{ item.label }}
                    </option>
                  </select>
                </div>
                <div class="field provider-model-row__name">
                  <label :for="`model-name-${model.rowKey}`">显示名称</label>
                  <input
                    :id="`model-name-${model.rowKey}`"
                    v-model="model.displayName"
                    maxlength="80"
                    placeholder="例如 GPT Image"
                  />
                </div>
                <div class="field provider-model-row__id">
                  <label :for="`model-id-${model.rowKey}`">模型 ID</label>
                  <input
                    :id="`model-id-${model.rowKey}`"
                    v-model="model.modelId"
                    maxlength="120"
                    placeholder="例如 gpt-image-2"
                  />
                </div>
                <button
                  class="icon-button provider-model-row__remove"
                  type="button"
                  title="移除模型"
                  aria-label="移除模型"
                  @click="removeModel(index)"
                >
                  <DeleteOutlined />
                </button>
              </div>

              <section v-if="model.modelType === 'image'" class="image-size-specs">
                <div class="image-size-specs__head">
                  <div>
                    <strong>图片尺寸规格</strong>
                    <p>
                      {{
                        form.providerType === 'grsai'
                          ? '节点比例用于画布显示；GRSAI 接口尺寸必须填写具体像素。'
                          : '节点比例用于画布显示；接口尺寸按供应商要求填写。'
                      }}
                    </p>
                  </div>
                  <div class="image-size-specs__actions">
                    <button
                      v-if="isGptImage2Vip(model)"
                      class="secondary-button"
                      type="button"
                      @click="applyGptImage2VipSpecs(model)"
                    >
                      同步官方规格
                    </button>
                    <button class="secondary-button" type="button" @click="addImageSizeSpec(model)">
                      <PlusOutlined />
                      添加规格
                    </button>
                  </div>
                </div>
                <div class="image-size-specs__list">
                  <div
                    v-for="(spec, specIndex) in model.sizeSpecs"
                    :key="spec.rowKey"
                    class="image-size-spec-row"
                  >
                    <div class="field">
                      <label>比例</label>
                      <input v-model="spec.ratio" maxlength="24" placeholder="16:9" />
                    </div>
                    <div class="field">
                      <label>清晰度</label>
                      <input v-model="spec.resolution" maxlength="24" placeholder="1K" />
                    </div>
                    <div class="field">
                      <label>接口尺寸</label>
                      <input
                        v-model="spec.requestSize"
                        maxlength="40"
                        :placeholder="
                          form.providerType === 'grsai' ? '例如 1792x1008' : '按接口要求填写'
                        "
                      />
                    </div>
                    <button
                      class="icon-button image-size-spec-row__remove"
                      type="button"
                      title="移除尺寸规格"
                      aria-label="移除尺寸规格"
                      @click="removeImageSizeSpec(model, specIndex)"
                    >
                      <DeleteOutlined />
                    </button>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </section>

        <label v-if="!form.isBuiltin" class="provider-form__toggle">
          <input v-model="form.enabled" type="checkbox" />
          <span>启用该供应商</span>
        </label>
      </div>
    </a-modal>

    <a-modal
      v-model:open="skillEditorOpen"
      :title="
        skillForm.kind === 'system'
          ? '编辑系统 Skill（开发模式）'
          : skillForm.id
            ? '编辑自定义 Skill'
            : '添加自定义 Skill'
      "
      :confirm-loading="savingSkill"
      ok-text="保存 Skill"
      cancel-text="取消"
      @ok="saveSkill"
    >
      <div class="provider-form">
        <div v-if="skillForm.kind === 'system'" class="skill-dev-notice">
          此操作会修改开发工作区中的系统 Skill 源文件，并自动递增版本号。
        </div>
        <div class="field">
          <label>名称</label>
          <input v-model="skillForm.name" maxlength="80" placeholder="例如：角色三视图" />
        </div>
        <div class="field">
          <label>说明</label>
          <input
            v-model="skillForm.description"
            maxlength="200"
            placeholder="这个 Skill 适合解决什么问题"
          />
        </div>
        <div class="field">
          <label>提示规则</label>
          <textarea
            v-model="skillForm.promptTemplate"
            rows="7"
            placeholder="描述构图、连续性和生成要求；可使用 [ratio:16:9] 指定比例"
          />
        </div>
        <div class="field">
          <label>排序</label>
          <input v-model.number="skillForm.sortOrder" type="number" min="0" />
        </div>
        <label v-if="skillForm.kind !== 'system'" class="provider-form__toggle">
          <input v-model="skillForm.enabled" type="checkbox" />
          <span>启用该 Skill</span>
        </label>
      </div>
    </a-modal>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { Modal, message } from 'ant-design-vue'
import {
  ApiOutlined,
  DeleteOutlined,
  ExportOutlined,
  LockOutlined,
  PlusOutlined,
  ThunderboltOutlined
} from '@ant-design/icons-vue'
import {
  getRuntimeCapabilities,
  getSystemSkillDeveloperDetail,
  openExternalUrl,
  saveSystemSkillDeveloperDetail,
  testProviderProfile
} from '../services/localBridge'
import {
  MODEL_TYPES,
  defaultImageSizeSpecs,
  gptImage2VipSizeSpecs,
  isModelType,
  modelTypesForProvider,
  modelTypeLabel,
  normalizeImageSizeSpecs,
  providerTypeSupportsModel
} from '../domain/providerModels'
import { useProviderStore } from '../stores/providers'
import { useSkillStore } from '../stores/skills'

defineProps({
  embedded: {
    type: Boolean,
    default: false
  }
})

const defaults = {
  deepseek: 'https://api.deepseek.com',
  grsai: 'https://grsai.dakka.com.cn',
  ark: 'https://ark.cn-beijing.volces.com',
  apimart: 'https://api.apimart.ai',
  minimax: 'https://api.minimaxi.com',
  ollama: 'http://127.0.0.1:11434'
}

const providerStore = useProviderStore()
const { profiles: providers } = storeToRefs(providerStore)
const skillStore = useSkillStore()
const { items: skills } = storeToRefs(skillStore)
const systemSkills = computed(() => skills.value.filter((skill) => skill.kind === 'system'))
const customSkills = computed(() => skills.value.filter((skill) => skill.kind !== 'system'))
const runtimeCapabilities = reactive({ systemSkillDeveloperMode: false })
const loading = ref(false)
const saving = ref(false)
const testingId = ref('')
const deletingId = ref('')
const testResults = reactive({})
const editorOpen = ref(false)
const activeSection = ref('providers')
const form = reactive(emptyForm())
const skillEditorOpen = ref(false)
const savingSkill = ref(false)
const skillForm = reactive(emptySkillForm())
let modelRowSequence = 0
let sizeSpecRowSequence = 0

onMounted(load)

function emptyForm() {
  return {
    id: '',
    name: '',
    providerType: 'openai-compatible',
    baseUrl: '',
    apiKey: '',
    enabled: true,
    hasApiKey: false,
    isBuiltin: false,
    officialUrl: '',
    models: []
  }
}

function emptySkillForm() {
  return {
    id: '',
    name: '',
    description: '',
    promptTemplate: '',
    enabled: true,
    sortOrder: 100,
    kind: 'custom',
    version: 1
  }
}

async function load() {
  loading.value = true
  try {
    const [, , capabilities] = await Promise.all([
      providerStore.load(),
      skillStore.load(),
      getRuntimeCapabilities()
    ])
    Object.assign(runtimeCapabilities, capabilities)
  } catch (error) {
    message.error(error.message)
  } finally {
    loading.value = false
  }
}

function resetForm(value = emptyForm()) {
  Object.assign(form, value)
}

function startCreate() {
  resetForm()
  addModel('text')
  editorOpen.value = true
}

function startEdit(provider) {
  resetForm({
    ...provider,
    models: (provider.models || []).map(withModelRowKey)
  })
  editorOpen.value = true
}

function applyProviderDefault() {
  form.baseUrl = defaults[form.providerType] || form.baseUrl
  const firstSupportedType = modelTypesForProvider(form.providerType)[0]?.value || 'text'
  form.models.forEach((model) => {
    if (!providerTypeSupportsModel(form.providerType, model.modelType)) {
      model.modelType = firstSupportedType
      handleModelTypeChange(model)
    }
  })
}

async function saveProvider() {
  if (!form.name.trim()) {
    message.warning('请输入配置名称')
    return
  }
  if (!form.baseUrl.trim()) {
    message.warning('请输入 Base URL')
    return
  }
  const models = form.models.map((item) => ({
    modelId: item.modelId.trim(),
    displayName: item.displayName.trim(),
    modelType: item.modelType,
    sizeSpecs:
      item.modelType === 'image'
        ? item.sizeSpecs.map((spec) => ({
            id: spec.id || null,
            ratio: spec.ratio.trim(),
            resolution: spec.resolution.trim(),
            requestSize: spec.requestSize.trim()
          }))
        : []
  }))
  if (models.some((item) => !providerTypeSupportsModel(form.providerType, item.modelType))) {
    message.warning('当前供应商不支持所选模型类型')
    return
  }
  if (models.some((item) => !item.modelId || !item.displayName)) {
    message.warning('请填写完整的模型显示名称和模型 ID')
    return
  }
  if (models.some((item) => item.modelType === 'image' && !item.sizeSpecs.length)) {
    message.warning('每个图片模型至少需要配置一个尺寸规格')
    return
  }
  if (
    models.some((item) =>
      item.sizeSpecs.some((spec) => !spec.ratio || !spec.resolution || !spec.requestSize)
    )
  ) {
    message.warning('请填写完整的图片尺寸规格')
    return
  }
  if (
    form.providerType === 'grsai' &&
    models.some(
      (item) =>
        item.modelType === 'image' &&
        item.sizeSpecs.some(
          (spec) =>
            spec.requestSize.toLowerCase() !== 'auto' && !/^\d+[xX]\d+$/.test(spec.requestSize)
        )
    )
  ) {
    message.warning('GRSAI 的接口尺寸必须填写 auto 或“宽x高”像素格式')
    return
  }
  const modelKeys = models.map((item) => `${item.modelType}:${item.modelId.toLowerCase()}`)
  if (new Set(modelKeys).size !== modelKeys.length) {
    message.warning('同一类型下不能重复配置相同模型')
    return
  }

  saving.value = true
  try {
    await providerStore.save({
      id: form.id || null,
      name: form.name.trim(),
      providerType: form.providerType,
      baseUrl: form.baseUrl.trim().replace(/\/+$/, ''),
      apiKey: form.apiKey.trim(),
      enabled: form.isBuiltin ? true : form.enabled,
      models
    })
    editorOpen.value = false
    await load()
    message.success('供应商配置已保存')
  } catch (error) {
    message.error(error.message)
  } finally {
    saving.value = false
  }
}

function addModel(modelType = 'text') {
  const supported = modelTypesForProvider(form.providerType)
  const selectedType = providerTypeSupportsModel(form.providerType, modelType)
    ? modelType
    : supported[0]?.value || 'text'
  form.models.push(withModelRowKey({ modelId: '', displayName: '', modelType: selectedType }))
}

function removeModel(index) {
  form.models.splice(index, 1)
}

function withModelRowKey(model) {
  modelRowSequence += 1
  const modelType = isModelType(model?.modelType) ? model.modelType : 'text'
  const configuredSpecs = normalizeImageSizeSpecs(model?.sizeSpecs)
  const sizeSpecs =
    modelType === 'image'
      ? (configuredSpecs.length ? configuredSpecs : defaultImageSizeSpecs()).map(withSizeSpecRowKey)
      : []
  return {
    id: String(model?.id || ''),
    modelId: String(model?.modelId || ''),
    displayName: String(model?.displayName || ''),
    modelType,
    sizeSpecs,
    rowKey: `model-${modelRowSequence}`
  }
}

function withSizeSpecRowKey(spec = {}) {
  sizeSpecRowSequence += 1
  return {
    id: String(spec.id || ''),
    ratio: String(spec.ratio || ''),
    resolution: String(spec.resolution || ''),
    requestSize: String(spec.requestSize || ''),
    rowKey: `size-spec-${sizeSpecRowSequence}`
  }
}

function handleModelTypeChange(model) {
  if (model.modelType === 'image' && !model.sizeSpecs.length) {
    model.sizeSpecs = defaultImageSizeSpecs().map(withSizeSpecRowKey)
  }
  if (model.modelType !== 'image') model.sizeSpecs = []
}

function addImageSizeSpec(model) {
  model.sizeSpecs.push(withSizeSpecRowKey())
}

function isGptImage2Vip(model) {
  return (
    form.providerType === 'grsai' &&
    String(model?.modelId || '')
      .trim()
      .toLowerCase() === 'gpt-image-2-vip'
  )
}

function applyGptImage2VipSpecs(model) {
  model.sizeSpecs = gptImage2VipSizeSpecs().map(withSizeSpecRowKey)
}

function removeImageSizeSpec(model, index) {
  model.sizeSpecs.splice(index, 1)
}

function providerModelGroups(provider) {
  const counts = new Map()
  ;(provider.models || []).forEach((model) => {
    counts.set(model.modelType, (counts.get(model.modelType) || 0) + 1)
  })
  return MODEL_TYPES.filter((item) => counts.has(item.value)).map((item) => ({
    type: item.value,
    label: modelTypeLabel(item.value),
    count: counts.get(item.value)
  }))
}

function startCreateSkill() {
  Object.assign(skillForm, emptySkillForm())
  skillEditorOpen.value = true
}

async function startEditSkill(skill) {
  try {
    const detail =
      skill.kind === 'system'
        ? await getSystemSkillDeveloperDetail(skill.id)
        : await skillStore.detail(skill.id)
    Object.assign(skillForm, emptySkillForm(), detail)
    skillEditorOpen.value = true
  } catch (error) {
    message.error(error.message)
  }
}

async function saveSkill() {
  if (!skillForm.name.trim() || !skillForm.promptTemplate.trim()) {
    message.warning('请填写 Skill 名称和提示规则')
    return
  }
  savingSkill.value = true
  try {
    const input = {
      ...skillForm,
      id: skillForm.id || null,
      name: skillForm.name.trim(),
      description: skillForm.description.trim(),
      promptTemplate: skillForm.promptTemplate.trim(),
      sortOrder: Number(skillForm.sortOrder || 0)
    }
    if (skillForm.kind === 'system') {
      await saveSystemSkillDeveloperDetail(skillForm.id, input)
      await skillStore.load()
    } else {
      await skillStore.save(input)
    }
    skillEditorOpen.value = false
    message.success(
      skillForm.kind === 'system' ? '系统 Skill 源文件已更新' : '自定义 Skill 已保存到本机'
    )
  } catch (error) {
    message.error(error.message)
  } finally {
    savingSkill.value = false
  }
}

function removeSkill(skill) {
  if (skill.kind === 'system') {
    message.warning('系统 Skill 不可删除')
    return
  }
  Modal.confirm({
    title: `删除 Skill“${skill.name}”？`,
    content: '删除后，AI 助手将不能再自动调用这个 Skill。',
    okText: '删除',
    okButtonProps: { danger: true },
    async onOk() {
      await skillStore.remove(skill.id)
    }
  })
}

function removeProvider(provider) {
  Modal.confirm({
    title: `删除“${provider.name}”？`,
    content: '供应商配置和其中填写的 API Key 会被移除；任务记录将继续保留。',
    okText: '删除',
    cancelText: '取消',
    okButtonProps: { danger: true },
    async onOk() {
      deletingId.value = provider.id
      try {
        await providerStore.remove(provider.id)
        delete testResults[provider.id]
        message.success(`已删除供应商“${provider.name}”`)
      } catch (error) {
        message.error(`删除失败：${error?.message || error}`)
        throw error
      } finally {
        deletingId.value = ''
      }
    }
  })
}

async function openProviderOfficialWebsite() {
  if (!form.officialUrl) return
  try {
    await openExternalUrl(form.officialUrl)
  } catch (error) {
    message.error(error?.message || String(error))
  }
}

async function testConnection(provider) {
  testingId.value = provider.id
  try {
    const result = await testProviderProfile(provider.id)
    const latency = result.latencyMs ? `，${result.latencyMs}ms` : ''
    testResults[provider.id] = {
      ok: true,
      message: `${result.message}${latency}`
    }
    message.success(`${result.message}${latency}`)
  } catch (error) {
    const errorMessage = error?.message || String(error)
    testResults[provider.id] = {
      ok: false,
      message: errorMessage
    }
    message.error(errorMessage)
  } finally {
    testingId.value = ''
  }
}

function providerInitial(provider) {
  return String(provider.name || provider.providerType || 'AI')
    .slice(0, 2)
    .toUpperCase()
}
</script>

<style scoped>
.settings--embedded {
  height: auto;
  padding: 0;
  overflow: visible;
}

.settings--embedded .page__header {
  margin-bottom: 20px;
}

.settings--embedded .page__subtitle {
  margin-top: 0;
}

.settings__layout {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr);
  gap: 28px;
  align-items: start;
}

.settings__nav {
  display: grid;
  gap: 7px;
}

.settings__nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 0 13px;
  border: 0;
  border-radius: 10px;
  color: var(--text-secondary);
  background: transparent;
  text-align: left;
}

.settings__nav-item small {
  margin-left: auto;
  font-size: 9px;
}

.settings__nav-item--active {
  color: var(--primary);
  background: var(--primary-soft);
}

.settings__content {
  min-width: 0;
  padding: 24px;
  border: 1px solid var(--border-soft);
  border-radius: 16px;
  background: var(--surface-translucent);
}

.settings__section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.settings__section-head .secondary-button {
  flex: 0 0 auto;
}

.settings__section-head h2,
.settings__section-head p {
  margin: 0;
}

.settings__section-head p {
  margin-top: 7px;
  color: var(--text-secondary);
}

.provider-list {
  display: grid;
  gap: 12px;
}

.provider-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 15px;
  border: 1px solid var(--border);
  border-radius: 13px;
  background: var(--surface-inset);
}

.provider-card__icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  color: var(--primary);
  background: var(--primary-soft);
  font-size: 12px;
  font-weight: 800;
}

.provider-card__copy {
  min-width: 0;
  flex: 1;
}

.provider-card__title {
  display: flex;
  align-items: center;
  gap: 9px;
}

.provider-card__title span {
  padding: 2px 6px;
  border-radius: 5px;
  color: var(--primary);
  background: var(--primary-soft);
  font-size: 10px;
}

.provider-card__title .provider-card__status--disabled {
  color: var(--text-secondary);
  background: var(--surface-soft);
}

.provider-card p,
.provider-card small {
  display: block;
  overflow: hidden;
  margin: 5px 0 0;
  color: var(--text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-card .provider-card__test-result {
  color: var(--primary);
}

.provider-card .provider-card__test-result--error {
  color: var(--danger);
}

.provider-card__models {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.provider-card__models span {
  padding: 3px 7px;
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  color: var(--text-secondary);
  background: var(--surface-soft);
  font-size: 10px;
}

.provider-card .provider-card__no-model {
  color: var(--warning, #d8a657);
}

.provider-card__delete {
  width: 38px;
  height: 38px;
}

.provider-form {
  display: grid;
  gap: 16px;
  padding-top: 8px;
}

.provider-form__custom-fields {
  display: grid;
  gap: 16px;
}

.builtin-provider-summary {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  color: var(--text-secondary);
  background: var(--surface-inset);
}

.builtin-provider-summary > :deep(.anticon) {
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--primary);
  font-size: 16px;
}

.builtin-provider-summary > div {
  min-width: 0;
  flex: 1;
}

.builtin-provider-summary strong {
  color: var(--text);
  font-size: 13px;
}

.builtin-provider-summary p {
  margin: 4px 0 12px;
  font-size: 12px;
}

.builtin-provider-summary dl {
  display: grid;
  gap: 6px;
  margin: 0;
}

.builtin-provider-summary dl div {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 8px;
  font-size: 12px;
}

.builtin-provider-summary dt {
  color: var(--text-secondary);
}

.builtin-provider-summary dd {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.builtin-provider-summary__link {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  gap: 6px;
  padding: 0;
  border: 0;
  color: var(--primary);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
}

.builtin-provider-summary__link span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.builtin-provider-summary__link:hover {
  color: var(--color-primary-hover);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.builtin-provider-summary__link:focus-visible {
  border-radius: 3px;
  outline: 2px solid var(--primary);
  outline-offset: 3px;
}

.builtin-provider-summary__link :deep(.anticon) {
  flex: 0 0 auto;
  font-size: 11px;
}

.provider-form__toggle {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--text-secondary);
}

.provider-models {
  display: grid;
  gap: 12px;
  padding-top: 4px;
}

.provider-models__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.provider-models__head p {
  margin: 5px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.provider-models__head .secondary-button {
  flex: 0 0 auto;
}

.provider-models__empty {
  padding: 16px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  color: var(--text-secondary);
  background: var(--surface-inset);
  text-align: center;
  font-size: 12px;
}

.provider-models__list {
  display: grid;
  gap: 10px;
  max-height: 520px;
  padding-right: 3px;
  overflow-y: auto;
}

.provider-model-card {
  display: grid;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  background: var(--surface-inset);
}

.provider-model-row {
  display: grid;
  grid-template-columns: 108px minmax(140px, 0.8fr) minmax(180px, 1.2fr) 38px;
  gap: 10px;
  align-items: end;
}

.provider-model-row__remove {
  width: 38px;
  height: 38px;
}

.image-size-specs {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border-soft);
  border-radius: 9px;
  background: var(--surface-soft);
}

.image-size-specs__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.image-size-specs__head strong {
  font-size: 12px;
}

.image-size-specs__head p {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 11px;
}

.image-size-specs__head .secondary-button {
  flex: 0 0 auto;
}

.image-size-specs__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.image-size-specs__list {
  display: grid;
  gap: 8px;
}

.image-size-spec-row {
  display: grid;
  grid-template-columns: minmax(90px, 0.7fr) minmax(90px, 0.7fr) minmax(160px, 1.3fr) 38px;
  gap: 8px;
  align-items: end;
}

.image-size-spec-row__remove {
  width: 38px;
  height: 38px;
}

.provider-form textarea {
  width: 100%;
  padding: 10px 11px;
  border: 1px solid var(--border);
  border-radius: 9px;
  outline: none;
  color: var(--text);
  line-height: 1.55;
  background: var(--surface-inset);
  resize: vertical;
}

.skill-list {
  display: grid;
  gap: 12px;
}

.skill-group {
  display: grid;
  gap: 12px;
}

.skill-group + .skill-group {
  margin-top: 26px;
  padding-top: 24px;
  border-top: 1px solid var(--border-soft);
}

.skill-group__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.skill-group__head h3,
.skill-group__head p {
  margin: 0;
}

.skill-group__head p {
  margin-top: 5px;
  color: var(--text-secondary);
  font-size: 12px;
}

.skill-dev-badge {
  padding: 4px 8px;
  border: 1px solid rgba(245, 181, 70, 0.35);
  border-radius: 999px;
  color: #f5b546;
  background: rgba(245, 181, 70, 0.1);
  font-size: 11px;
}

.skill-dev-notice {
  padding: 10px 12px;
  border: 1px solid rgba(245, 181, 70, 0.3);
  border-radius: 9px;
  color: #e9b85e;
  background: rgba(245, 181, 70, 0.08);
  font-size: 12px;
  line-height: 1.55;
}

.skill-card {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto auto;
  gap: 14px;
  align-items: center;
  padding: 16px;
  border: 1px solid var(--border-soft);
  border-radius: 14px;
  background: var(--surface-translucent);
}

.skill-card--system {
  grid-template-columns: 44px minmax(0, 1fr) auto;
}

.skill-card__badge {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  color: var(--primary);
  background: rgba(22, 216, 199, 0.1);
}

.skill-card__badge--system {
  color: var(--text-secondary);
  background: var(--surface-inset);
}

.skill-card__copy {
  display: grid;
  gap: 4px;
}

.skill-card__copy > div {
  display: flex;
  align-items: center;
  gap: 9px;
}

.skill-card__copy span {
  color: #69dca9;
  font-size: 10px;
}

.skill-card__copy p {
  margin: 0;
  color: var(--text-secondary);
}

.settings__empty-icon {
  margin-bottom: 10px;
  color: var(--primary);
  font-size: 40px;
}

@media (max-width: 860px) {
  .settings__layout {
    grid-template-columns: 1fr;
  }

  .settings__nav {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .provider-model-row {
    grid-template-columns: 96px minmax(128px, 0.8fr) minmax(160px, 1.2fr) 38px;
  }

  .image-size-spec-row {
    grid-template-columns: minmax(80px, 0.7fr) minmax(80px, 0.7fr) minmax(140px, 1.3fr) 38px;
  }
}
</style>
