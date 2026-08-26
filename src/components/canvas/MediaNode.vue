<template>
  <div class="media-node-wrapper" :class="{ 'media-node-wrapper--selected': selected }">
    <div v-if="selected" class="media-node-toolbar-card nodrag nopan">
      <button
        class="media-toolbar__btn nodrag nopan"
        type="button"
        title="上传本地文件"
        @pointerdown.stop
        @click.stop="ui?.importNode(id)"
      >
        <UploadOutlined />
      </button>
      <button
        class="media-toolbar__btn media-toolbar__btn--danger nodrag nopan"
        type="button"
        title="删除节点"
        @pointerdown.stop
        @click.stop="ui?.deleteNode(id)"
      >
        <DeleteOutlined />
      </button>
      <button
        v-if="data.assetId"
        class="media-toolbar__btn nodrag nopan"
        type="button"
        title="导出"
        @pointerdown.stop
        @click.stop="ui?.exportNode(id)"
      >
        <DownloadOutlined />
      </button>
      <button
        v-if="data.assetId && kind === 'image'"
        class="media-toolbar__btn nodrag nopan"
        type="button"
        title="复制图片"
        @pointerdown.stop
        @click.stop="ui?.copyImage(id)"
      >
        <CopyOutlined />
      </button>
      <button
        v-if="data.assetId && kind !== 'audio'"
        class="media-toolbar__btn nodrag nopan"
        type="button"
        title="放大查看"
        @pointerdown.stop
        @click.stop="ui?.previewNode(id)"
      >
        <FullscreenOutlined />
      </button>
    </div>

    <div class="media-node-title-row nodrag nopan" @dblclick.stop="startEditName">
      <component :is="kindIcon" class="media-node-title-row__type-icon" />
      <input
        v-if="editingName"
        ref="nameInputRef"
        v-model="editingNameValue"
        class="media-node-title-row__name-input nodrag nopan"
        maxlength="60"
        @blur="confirmEditName"
        @keydown.enter.prevent="confirmEditName"
        @keydown.esc.prevent="cancelEditName"
        @pointerdown.stop
        @dblclick.stop
      />
      <button
        v-else
        class="media-node-title-row__name"
        type="button"
        :title="`${nodeName}（双击修改）`"
        @dblclick.stop="startEditName"
      >
        {{ nodeName }}
      </button>
    </div>

    <div
      class="media-node-preview-card"
      :class="[`media-node--${kind}`, { 'media-node--selected': selected }]"
    >
      <Handle id="target" type="target" :position="Position.Left" class="handle-left">
        <PlusOutlined class="handle-icon" />
      </Handle>
      <Handle id="source" type="source" :position="Position.Right" class="handle-right">
        <PlusOutlined class="handle-icon" />
      </Handle>

      <div class="media-node-preview" :style="previewStyle">
        <div v-if="generating" class="generating-overlay">
          <span class="generating-status">{{ mediaKindLabel(kind) }}生成中</span>
        </div>
        <template v-else>
          <div v-if="data.taskStatus === 'failed'" class="failed-state">
            <span>生成失败</span>
            <small>{{ data.taskError || '请调整参数后重试' }}</small>
            <button type="button" @click.stop="ui?.generateNode(id)">重试</button>
          </div>
          <img
            v-else-if="kind === 'image' && data.assetUrl"
            :src="data.assetUrl"
            alt=""
            class="media-node__asset"
          />
          <video
            v-else-if="kind === 'video' && data.assetUrl"
            :src="data.assetUrl"
            controls
            preload="metadata"
            class="media-node__asset nodrag nopan"
          />
          <audio
            v-else-if="kind === 'audio' && data.assetUrl"
            :src="data.assetUrl"
            controls
            preload="metadata"
            class="nodrag nopan"
          />
          <div v-else class="media-node__empty">
            <component :is="kindIcon" />
          </div>
        </template>
      </div>
    </div>

    <div v-if="selected" class="media-node-form-card nodrag nopan nowheel">
      <div class="media-node__prompt-area">
        <div v-if="kind !== 'audio' && references.length" class="reference-strip">
          <div
            v-for="reference in references"
            :key="reference.id"
            class="reference-strip__card"
            :title="reference.data.title || reference.data.name || mediaKindLabel(reference.type)"
          >
            <img
              v-if="reference.type === 'image'"
              :src="reference.data.assetUrl"
              alt=""
              class="reference-strip__item"
            />
            <video
              v-else-if="reference.type === 'video'"
              :src="reference.data.assetUrl"
              muted
              playsinline
              preload="metadata"
              class="reference-strip__item"
            />
            <div v-else class="reference-strip__item reference-strip__item--audio">
              <AudioOutlined />
              <span>音频</span>
            </div>
            <div class="reference-strip__badge">
              <PictureOutlined v-if="reference.type === 'image'" />
              <VideoCameraOutlined v-else-if="reference.type === 'video'" />
              <AudioOutlined v-else />
            </div>
            <button
              type="button"
              class="reference-strip__remove nodrag nopan"
              title="移除参考关系"
              @click.stop="ui?.removeReference(id, reference.id)"
            >
              ×
            </button>
          </div>
        </div>

        <textarea
          class="prompt-textarea nodrag nopan nowheel"
          :value="data.prompt"
          :placeholder="promptPlaceholder"
          rows="3"
          @input="update('prompt', $event.target.value)"
          @keydown.ctrl.enter.prevent="ui?.generateNode(id)"
          @keydown.meta.enter.prevent="ui?.generateNode(id)"
        />

        <div class="prompt-toolbar">
          <a-select
            class="model-input nodrag nopan nowheel"
            :value="selectedModelId"
            :options="modelSelectOptions"
            size="small"
            placeholder="选择模型"
            title="模型"
            @pointerdown.stop
            @change="ui?.changeModel(id, $event)"
          />
          <input
            v-if="kind === 'audio'"
            class="toolbar-control voice-input nodrag nopan"
            :value="data.voiceId"
            placeholder="音色 ID"
            title="音色 ID"
            @input="update('voiceId', $event.target.value)"
          />
          <button
            v-if="kind !== 'audio'"
            class="spec-trigger nodrag nopan"
            type="button"
            @click.stop="specOpen = !specOpen"
          >
            <span>{{ specSummary }}</span>
            <DownOutlined />
          </button>
          <div class="prompt-toolbar__spacer" />
          <span v-if="data.taskStatus !== 'completed'" class="cost-info">
            <ThunderboltOutlined />
            {{ statusLabel }}
          </span>
          <button
            class="generate-btn nodrag nopan"
            type="button"
            title="开始生成"
            :disabled="generating"
            @click.stop="ui?.generateNode(id)"
          >
            <LoadingOutlined v-if="generating" spin />
            <ArrowUpOutlined v-else />
          </button>
        </div>

        <div v-if="kind === 'audio'" class="audio-options">
          <label>
            <span>语速</span>
            <input
              type="number"
              min="0.5"
              max="2"
              step="0.1"
              :value="data.speed"
              @input="update('speed', Number($event.target.value))"
            />
          </label>
          <label>
            <span>格式</span>
            <select :value="data.format" @change="update('format', $event.target.value)">
              <option value="mp3">MP3</option>
              <option value="wav">WAV</option>
              <option value="flac">FLAC</option>
            </select>
          </label>
        </div>

        <div v-if="specOpen && kind !== 'audio'" class="spec-panel" @click.stop>
          <div v-if="kind === 'image'" class="spec-panel__section">
            <template v-if="imageSizeSpecs.length">
              <div class="spec-panel__title">分辨率</div>
              <div class="spec-panel__resolutions spec-panel__resolutions--image">
                <button
                  v-for="option in imageResolutions"
                  :key="option"
                  type="button"
                  :class="[
                    'spec-option',
                    'spec-option--resolution',
                    { 'spec-option--active': option === activeImageResolution }
                  ]"
                  @click.stop="selectImageResolution(option)"
                >
                  {{ option }}
                </button>
              </div>
              <div class="spec-panel__title spec-panel__title--image-ratio">比例</div>
              <div class="spec-panel__ratios spec-panel__ratios--image">
                <button
                  v-for="option in imageRatios"
                  :key="option"
                  type="button"
                  :class="[
                    'spec-option',
                    'spec-option--ratio',
                    { 'spec-option--active': option === activeImageRatio }
                  ]"
                  @click.stop="selectImageRatio(option)"
                >
                  <span class="spec-option__icon" :data-ratio="option" />
                  <span>{{ option }}</span>
                </button>
              </div>
            </template>
            <div v-else class="spec-panel__empty">请先在模型配置中添加图片尺寸规格</div>
          </div>
          <div v-if="kind === 'video'" class="spec-panel__section">
            <div class="spec-panel__title">分辨率</div>
            <div class="spec-panel__resolutions">
              <button
                v-for="option in resolutionOptions"
                :key="option"
                type="button"
                :class="[
                  'spec-option',
                  'spec-option--resolution',
                  { 'spec-option--active': option === data.resolution }
                ]"
                @click.stop="update('resolution', option)"
              >
                {{ option }}
              </button>
            </div>
          </div>
          <div v-if="kind === 'video'" class="spec-panel__section">
            <div class="spec-panel__title">比例</div>
            <div class="spec-panel__ratios">
              <button
                v-for="option in ratioOptions"
                :key="option"
                type="button"
                :class="[
                  'spec-option',
                  'spec-option--ratio',
                  { 'spec-option--active': option === effectiveRatio }
                ]"
                @click.stop="setRatio(option)"
              >
                <span class="spec-option__icon" :data-ratio="option" />
                <span>{{ option === 'adaptive' ? '自适应' : option }}</span>
              </button>
            </div>
          </div>
          <div v-if="kind === 'video'" class="spec-panel__section">
            <div class="spec-panel__title spec-panel__title--split">
              <span>视频时长</span>
              <span>{{ Number(data.duration || 5) }}s</span>
            </div>
            <input
              class="duration-slider"
              type="range"
              min="5"
              max="10"
              step="1"
              :value="Number(data.duration || 5)"
              @input="update('duration', Number($event.target.value))"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, inject, nextTick, ref, watch } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import {
  ArrowUpOutlined,
  AudioOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  DownOutlined,
  FullscreenOutlined,
  LoadingOutlined,
  PictureOutlined,
  PlusOutlined,
  ThunderboltOutlined,
  UploadOutlined,
  VideoCameraOutlined
} from '@ant-design/icons-vue'
import {
  imageRatioOptions,
  imageResolutionOptions,
  imageSizeSpecForSelection
} from '../../domain/providerModels'
import { isTaskActive, taskStatusLabel } from '../../domain/taskStatus'

const props = defineProps({
  id: { type: String, required: true },
  type: { type: String, required: true },
  data: { type: Object, default: () => ({}) },
  selected: { type: Boolean, default: false }
})

const ui = inject('media-node-ui', null)
const editingName = ref(false)
const editingNameValue = ref('')
const nameInputRef = ref(null)
const specOpen = ref(false)
const selectedImageResolution = ref('')
const kind = computed(() => props.type)
const nodeName = computed(
  () =>
    props.data.title ||
    props.data.name ||
    {
      image: '图片节点',
      video: '视频节点',
      audio: '音频节点'
    }[kind.value]
)
const kindIcon = computed(
  () =>
    ({
      image: PictureOutlined,
      video: VideoCameraOutlined,
      audio: AudioOutlined
    })[kind.value]
)
const generating = computed(() => isTaskActive(props.data.taskStatus))
const statusLabel = computed(() => taskStatusLabel(props.data.taskStatus))
const modelOptions = computed(() => ui?.modelsForKind(kind.value) || [])
const modelSelectOptions = computed(() =>
  modelOptions.value.map((model) => ({
    value: model.selectionId,
    label: model.label
  }))
)
const selectedModelId = computed(
  () =>
    modelOptions.value.find(
      (model) => model.providerId === props.data.providerId && model.modelId === props.data.model
    )?.selectionId || ''
)
const selectedModel = computed(
  () => modelOptions.value.find((model) => model.selectionId === selectedModelId.value) || null
)
const imageSizeSpecs = computed(() =>
  kind.value === 'image' && Array.isArray(selectedModel.value?.sizeSpecs)
    ? selectedModel.value.sizeSpecs
    : []
)
const selectedSizeSpecId = computed(() => {
  const configuredId = String(props.data.sizeSpecId || '')
  if (imageSizeSpecs.value.some((spec) => spec.id === configuredId)) return configuredId
  return (
    imageSizeSpecs.value.find(
      (spec) => spec.ratio === effectiveRatio.value && spec.resolution === props.data.resolution
    )?.id ||
    imageSizeSpecs.value[0]?.id ||
    ''
  )
})
const selectedImageSpec = computed(
  () => imageSizeSpecs.value.find((spec) => spec.id === selectedSizeSpecId.value) || null
)
const imageResolutions = computed(() => imageResolutionOptions(imageSizeSpecs.value))
const activeImageResolution = computed(() => {
  const selectedResolution = selectedImageSpec.value?.resolution
  if (selectedResolution && selectedResolution.toLowerCase() !== 'auto') {
    return selectedResolution
  }
  if (imageResolutions.value.includes(selectedImageResolution.value)) {
    return selectedImageResolution.value
  }
  return imageResolutions.value[0] || ''
})
const imageRatios = computed(() =>
  imageRatioOptions(imageSizeSpecs.value, activeImageResolution.value)
)
const activeImageRatio = computed(() => selectedImageSpec.value?.ratio || '')
const references = computed(() => ui?.referencesForNode(props.id) || [])
const effectiveRatio = computed(() =>
  kind.value === 'image' ? props.data.aspectRatio || '1:1' : props.data.ratio || 'adaptive'
)
const ratioOptions = computed(() => ['adaptive', '16:9', '9:16', '1:1'])
const resolutionOptions = computed(() =>
  kind.value === 'video' ? ['480p', '720p', '1080p'] : ['1K', '2K', '4K']
)
const specSummary = computed(() => {
  if (kind.value === 'image') {
    const spec = imageSizeSpecs.value.find((item) => item.id === selectedSizeSpecId.value)
    return spec ? `${spec.resolution} · ${spec.ratio}` : '未配置尺寸'
  }
  return [
    props.data.resolution || resolutionOptions.value[0],
    effectiveRatio.value,
    `${Number(props.data.duration || 5)}s`
  ]
    .filter(Boolean)
    .join(' · ')
})
const previewStyle = computed(() => ({
  '--media-node-aspect-ratio': aspectRatioValue(effectiveRatio.value)
}))
const promptPlaceholder = computed(() =>
  kind.value === 'audio'
    ? '描述想要生成的语音内容... (Ctrl+Enter 生成)'
    : '描述想要生成的内容，可使用 @节点名 引用素材... (Ctrl+Enter 生成)'
)

watch(
  () => [selectedModelId.value, selectedImageSpec.value?.resolution],
  ([, resolution]) => {
    if (resolution && String(resolution).toLowerCase() !== 'auto') {
      selectedImageResolution.value = resolution
    } else if (!imageResolutions.value.includes(selectedImageResolution.value)) {
      selectedImageResolution.value = imageResolutions.value[0] || ''
    }
  },
  { immediate: true }
)

function update(field, value) {
  ui?.updateNode(props.id, field, value)
}

function setRatio(value) {
  update(kind.value === 'image' ? 'aspectRatio' : 'ratio', value)
}

function selectImageResolution(resolution) {
  selectedImageResolution.value = resolution
  const currentRatio = activeImageRatio.value
  const nextSpec =
    imageSizeSpecForSelection(imageSizeSpecs.value, resolution, currentRatio) ||
    imageSizeSpecs.value.find(
      (spec) => spec.resolution === resolution && spec.ratio.toLowerCase() !== 'auto'
    )
  if (nextSpec) ui?.changeSizeSpec(props.id, nextSpec.id)
}

function selectImageRatio(ratio) {
  const nextSpec = imageSizeSpecForSelection(
    imageSizeSpecs.value,
    activeImageResolution.value,
    ratio
  )
  if (nextSpec) ui?.changeSizeSpec(props.id, nextSpec.id)
}

function startEditName() {
  editingNameValue.value = nodeName.value
  editingName.value = true
  nextTick(() => nameInputRef.value?.focus())
}

function confirmEditName() {
  const value = editingNameValue.value.trim()
  if (value) update('title', value)
  editingName.value = false
}

function cancelEditName() {
  editingName.value = false
}

function aspectRatioValue(value) {
  return (
    {
      '1:1': '1 / 1',
      '4:3': '4 / 3',
      '3:4': '3 / 4',
      '4:5': '4 / 5',
      '5:4': '5 / 4',
      '16:9': '16 / 9',
      '21:9': '21 / 9',
      '9:16': '9 / 16',
      '9:21': '9 / 21',
      '3:2': '3 / 2',
      '2:3': '2 / 3',
      '1:3': '1 / 3',
      '3:1': '3 / 1',
      '2:1': '2 / 1',
      '1:2': '1 / 2',
      auto: '1 / 1',
      adaptive: '16 / 9'
    }[value] || '4 / 3'
  )
}

function mediaKindLabel(value) {
  return (
    {
      image: '图片',
      video: '视频',
      audio: '音频'
    }[value] || '参考素材'
  )
}
</script>

<style scoped>
.media-node-wrapper {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  gap: 6px;
  width: 320px;
  color: var(--color-text);
  font-family:
    'PingFang SC',
    'Microsoft YaHei',
    -apple-system,
    sans-serif;
}

.media-node-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 16px;
  padding: 0 2px;
}

.media-node-title-row__type-icon {
  flex: 0 0 auto;
  color: color-mix(in srgb, var(--text-secondary) 72%, transparent);
  font-size: 9px;
}

.media-node-title-row__name,
.media-node-title-row__name-input {
  flex: 1 1 auto;
  min-width: 0;
  display: block;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 9px;
  font-weight: 500;
  line-height: 1.3;
  text-align: left;
}

.media-node-title-row__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: text;
}

.media-node-title-row__name-input {
  height: 20px;
}

.media-node-preview-card {
  position: relative;
  width: 100%;
  overflow: visible;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  transition:
    border-color var(--transition-base),
    box-shadow var(--transition-base);
}

.media-node-preview-card:hover {
  border-color: var(--color-border-secondary);
  box-shadow: var(--shadow-md);
}

.media-node-preview-card.media-node--selected {
  border-color: var(--text);
  box-shadow: var(--shadow-sm);
}

.media-node-preview {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: var(--media-node-aspect-ratio, 4 / 3);
  overflow: hidden;
  border-radius: calc(var(--radius-lg) - 2px);
  background: var(--color-bg-tertiary);
}

.media-node__asset {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.media-node-preview audio {
  z-index: 1;
  width: calc(100% - 32px);
}

.media-node__empty {
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  font-size: 44px;
  opacity: 0.15;
}

.generating-overlay,
.failed-state {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 30px;
  text-align: center;
  background: rgba(8, 12, 17, 0.7);
  backdrop-filter: blur(4px);
}

.generating-overlay {
  isolation: isolate;
  align-items: flex-start;
  justify-content: flex-start;
  padding: 9px;
  overflow: hidden;
  color: #ffffff;
  background:
    radial-gradient(circle at 18% 16%, rgba(131, 226, 230, 0.72), transparent 38%),
    radial-gradient(circle at 82% 76%, rgba(33, 114, 212, 0.72), transparent 46%),
    linear-gradient(125deg, #55b7c9 0%, #32a9d2 38%, #247fc4 68%, #4db9c2 100%);
  background-size: 180% 180%;
  backdrop-filter: none;
  animation: generating-gradient-flow 5.4s ease-in-out infinite alternate;
}

.generating-overlay::before,
.generating-overlay::after {
  position: absolute;
  z-index: -1;
  content: '';
  pointer-events: none;
}

.generating-overlay::before {
  inset: -55%;
  background:
    radial-gradient(circle, rgba(255, 255, 255, 0.24) 0%, transparent 34%),
    radial-gradient(circle at 75% 30%, rgba(42, 216, 211, 0.3) 0%, transparent 28%);
  filter: blur(12px);
  animation: generating-glow-drift 6.8s ease-in-out infinite alternate;
}

.generating-overlay::after {
  top: -35%;
  bottom: -35%;
  left: -55%;
  width: 42%;
  opacity: 0.42;
  background: linear-gradient(100deg, transparent, rgba(255, 255, 255, 0.28), transparent);
  filter: blur(8px);
  transform: skewX(-14deg);
  animation: generating-shimmer 3.8s ease-in-out infinite;
}

.generating-status {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 4px 8px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 5px;
  color: rgba(255, 255, 255, 0.94);
  font-size: 10px;
  font-weight: 600;
  line-height: 1.2;
  background: rgba(12, 78, 129, 0.28);
  box-shadow: 0 4px 12px rgba(10, 65, 112, 0.14);
  backdrop-filter: blur(6px);
}

.failed-state small {
  color: var(--color-text-secondary);
  font-size: 11px;
}

.failed-state > span {
  color: var(--color-error);
  font-size: 13px;
  font-weight: 600;
}

.failed-state button {
  padding: 5px 16px;
  border: 1px solid rgba(239, 68, 68, 0.35);
  border-radius: var(--radius-md);
  color: var(--color-error);
  background: rgba(239, 68, 68, 0.1);
  cursor: pointer;
}

.media-node-wrapper :deep(.vue-flow__handle) {
  z-index: 10;
  width: 2px;
  min-width: 2px;
  height: 32px;
  box-sizing: border-box;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  pointer-events: auto;
}

.media-node-wrapper :deep(.handle-left) {
  left: 0;
}

.media-node-wrapper :deep(.handle-right) {
  right: 0;
}

.media-node-wrapper :deep(.vue-flow__handle::before) {
  position: absolute;
  top: 0;
  width: 42px;
  height: 100%;
  content: '';
  background: transparent;
  pointer-events: auto;
}

.media-node-wrapper :deep(.handle-left::before) {
  right: 0;
}

.media-node-wrapper :deep(.handle-right::before) {
  left: 0;
}

.media-node-wrapper :deep(.handle-icon) {
  position: absolute;
  top: 50%;
  left: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  box-sizing: border-box;
  border: 2px solid rgba(190, 198, 207, 0.78);
  border-radius: 50%;
  color: rgba(218, 224, 231, 0.92);
  font-size: 11px;
  line-height: 1;
  opacity: 0;
  background: rgba(12, 17, 22, 0.94);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.1),
    0 4px 12px rgba(0, 0, 0, 0.32);
  pointer-events: none;
  transform: translate(-50%, -50%);
  transition:
    opacity var(--transition-fast),
    border-color var(--transition-fast),
    background-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.media-node-wrapper :deep(.handle-left .handle-icon) {
  left: calc(50% - 25px);
}

.media-node-wrapper :deep(.handle-right .handle-icon) {
  left: calc(50% + 25px);
}

.media-node-wrapper:hover :deep(.handle-icon),
.media-node-wrapper--selected :deep(.handle-icon) {
  opacity: 1;
}

.media-node-wrapper :deep(.vue-flow__handle:hover .handle-icon) {
  border-color: rgba(236, 240, 244, 0.96);
  background: rgba(19, 25, 32, 0.98);
  box-shadow:
    0 0 0 3px rgba(194, 202, 211, 0.12),
    0 5px 14px rgba(0, 0, 0, 0.38);
}

.media-node-toolbar-card {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-height: 40px;
  padding: 4px 6px;
  border: 1px solid var(--color-border-secondary);
  border-radius: var(--radius-lg);
  background: rgba(20, 25, 32, 0.92);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(12px);
  transform: translateX(-50%);
  animation: slideUp 0.18s var(--ease-out);
}

.media-toolbar__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: 14px;
  background: transparent;
  cursor: pointer;
  transition:
    color var(--transition-fast),
    background var(--transition-fast),
    border-color var(--transition-fast);
}

.media-toolbar__btn:hover {
  border-color: rgba(14, 214, 202, 0.3);
  color: var(--color-primary);
  background: rgba(14, 214, 202, 0.1);
}

.media-toolbar__btn--danger:hover {
  border-color: rgba(255, 120, 117, 0.35);
  color: #ff7875;
  background: rgba(255, 120, 117, 0.12);
}

.media-node-form-card {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  z-index: 10;
  width: 500px;
  overflow: visible;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-md);
  background: rgba(20, 25, 32, 0.75);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(20px);
  transform: translateX(-50%);
  animation: slideDown 0.18s var(--ease-out);
}

.media-node__prompt-area {
  position: relative;
  padding: 10px;
}

.prompt-textarea {
  width: 100%;
  min-height: 72px;
  max-height: 168px;
  margin: 0 0 10px;
  padding: 9px 11px;
  resize: vertical;
  overflow-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  border: 1px solid var(--color-border-secondary);
  border-radius: var(--radius-md);
  outline: none;
  color: var(--color-text);
  font-size: 12px;
  line-height: 1.6;
  background: var(--color-bg-tertiary);
  caret-color: var(--color-text);
  transition:
    border-color var(--transition-base),
    box-shadow var(--transition-base),
    background var(--transition-base);
}

.prompt-textarea::-webkit-scrollbar {
  display: none;
}

.prompt-textarea::placeholder {
  color: var(--color-text-tertiary);
}

.prompt-textarea:hover,
.prompt-textarea:focus {
  border-color: rgba(255, 255, 255, 0.18);
}

.prompt-textarea:focus {
  background: var(--color-bg-elevated);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.06);
}

.prompt-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 3px;
}

.toolbar-control,
.spec-trigger {
  height: 24px;
  min-width: 0;
  padding: 0 4px;
  border: 0;
  outline: 0;
  color: var(--color-text-secondary);
  font-size: 11px;
  background: transparent;
}

.toolbar-control option {
  color: var(--color-text);
  background: var(--color-bg-elevated);
}

.model-input {
  width: 180px;
  max-width: 46%;
}

.model-input :deep(.ant-select-selector) {
  padding-inline: 8px !important;
  border-color: transparent !important;
  background: transparent !important;
  box-shadow: none !important;
}

.model-input:hover :deep(.ant-select-selector),
.model-input.ant-select-focused :deep(.ant-select-selector) {
  border-color: var(--color-border-secondary) !important;
  background: var(--color-bg-tertiary) !important;
}

.model-input :deep(.ant-select-selection-item),
.model-input :deep(.ant-select-selection-placeholder),
.model-input :deep(.ant-select-arrow) {
  color: var(--color-text-secondary);
  font-size: 11px;
}

.voice-input {
  width: 110px;
}

.toolbar-control:focus {
  color: var(--color-text);
}

.spec-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 184px;
  cursor: pointer;
}

.spec-trigger svg {
  flex: 0 0 auto;
  font-size: 10px;
  opacity: 0.58;
}

.prompt-toolbar__spacer {
  flex: 1;
}

.cost-info {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: var(--radius-full);
  color: var(--color-text-tertiary);
  font-size: 11px;
  font-weight: 500;
}

.generate-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-full);
  color: var(--color-text-on-primary);
  background: var(--color-primary);
  box-shadow: var(--shadow-glow-xs);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.generate-btn:hover {
  background: var(--color-primary-hover);
  border-color: var(--color-primary-hover);
  box-shadow: var(--shadow-glow-sm);
  transform: scale(1.08);
}

.generate-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.reference-strip {
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
  overflow-x: auto;
  scrollbar-width: none;
}

.reference-strip::-webkit-scrollbar {
  display: none;
}

.reference-strip__card {
  position: relative;
  flex: 0 0 52px;
}

.reference-strip__item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border: 1px solid var(--color-border-secondary);
  border-radius: var(--radius-sm);
  object-fit: cover;
  background: var(--color-bg-tertiary);
  transition: border-color var(--transition-fast);
}

.reference-strip__item:hover {
  border-color: var(--color-primary);
}

.reference-strip__item--audio {
  flex-direction: column;
  gap: 4px;
  color: var(--color-text-secondary);
  font-size: 10px;
}

.reference-strip__item--audio svg {
  font-size: 16px;
}

.reference-strip__badge {
  position: absolute;
  bottom: 4px;
  left: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-full);
  color: rgba(236, 241, 245, 0.9);
  font-size: 9px;
  background: rgba(8, 12, 17, 0.82);
}

.reference-strip__remove {
  position: absolute;
  top: -5px;
  right: -5px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: var(--radius-full);
  color: var(--color-text-tertiary);
  font-size: 11px;
  line-height: 1;
  background: rgba(13, 18, 24, 0.95);
  cursor: pointer;
  transition:
    color var(--transition-fast),
    border-color var(--transition-fast),
    background var(--transition-fast);
}

.reference-strip__remove:hover {
  border-color: rgba(239, 68, 68, 0.5);
  color: #fff;
  background: rgba(164, 46, 46, 0.95);
}

.spec-panel {
  position: absolute;
  top: auto;
  bottom: 38px;
  left: 10px;
  z-index: 20;
  width: 312px;
  padding: 14px;
  border: 1px solid var(--color-border-secondary);
  border-radius: var(--radius-xl);
  background: var(--color-bg-elevated);
  box-shadow: var(--shadow-xl);
}

.spec-panel__section + .spec-panel__section {
  margin-top: 14px;
}

.spec-panel__title {
  margin-bottom: 10px;
  color: var(--color-text-tertiary);
  font-size: 12px;
  line-height: 1;
}

.spec-panel__title--split {
  display: flex;
  justify-content: space-between;
}

.spec-panel__title--image-ratio {
  margin-top: 16px;
}

.spec-panel__resolutions,
.spec-panel__ratios,
.spec-panel__sizes {
  display: grid;
  gap: 10px;
}

.spec-panel__resolutions {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.spec-panel__resolutions--image {
  display: flex;
  flex-wrap: wrap;
}

.spec-panel__resolutions--image .spec-option {
  flex: 0 0 calc((100% - 20px) / 3);
}

.spec-panel__ratios {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.spec-panel__empty {
  padding: 14px;
  border: 1px dashed var(--color-border-secondary);
  border-radius: 10px;
  color: var(--color-text-tertiary);
  font-size: 11px;
  text-align: center;
}

.spec-option {
  border: 1px solid var(--color-border-secondary);
  color: var(--color-text-secondary);
  background: transparent;
  cursor: pointer;
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast),
    color var(--transition-fast);
}

.spec-option:hover {
  border-color: rgba(255, 255, 255, 0.18);
  color: var(--color-text);
  background: var(--color-bg-tertiary);
}

.spec-option--active {
  border-color: rgba(255, 255, 255, 0.42);
  color: #fff;
  font-weight: 700;
  background: rgba(11, 16, 21, 0.92);
}

.spec-option--resolution {
  height: 40px;
  border-radius: 10px;
  font-size: 14px;
}

.spec-option--ratio {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 76px;
  padding: 10px 6px;
  border-radius: 12px;
  font-size: 12px;
}

.spec-option__icon {
  display: block;
  width: 16px;
  height: 12px;
  border: 1.5px solid currentColor;
  border-radius: 3px;
}

.spec-option__icon[data-ratio='1:1'],
.spec-option__icon[data-ratio='auto'],
.spec-option__icon[data-ratio='adaptive'] {
  width: 12px;
  height: 12px;
}

.spec-option__icon[data-ratio='9:16'],
.spec-option__icon[data-ratio='9:21'],
.spec-option__icon[data-ratio='4:5'],
.spec-option__icon[data-ratio='3:4'],
.spec-option__icon[data-ratio='2:3'] {
  width: 9px;
  height: 16px;
}

.spec-option__icon[data-ratio='16:9'],
.spec-option__icon[data-ratio='5:4'],
.spec-option__icon[data-ratio='4:3'],
.spec-option__icon[data-ratio='3:2'],
.spec-option__icon[data-ratio='21:9'] {
  width: 18px;
  height: 10px;
}

.spec-option__icon[data-ratio='1:3'],
.spec-option__icon[data-ratio='1:2'] {
  width: 7px;
  height: 18px;
}

.spec-option__icon[data-ratio='3:1'],
.spec-option__icon[data-ratio='2:1'] {
  width: 20px;
  height: 8px;
}

.duration-slider {
  width: 100%;
  accent-color: var(--color-primary);
}

.audio-options {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}

.audio-options label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-tertiary);
  font-size: 11px;
}

.audio-options input,
.audio-options select {
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--color-border-secondary);
  border-radius: var(--radius-md);
  outline: none;
  color: var(--color-text-secondary);
  background: var(--color-bg-tertiary);
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

@keyframes generating-gradient-flow {
  0% {
    background-position: 0% 30%;
  }
  50% {
    background-position: 65% 70%;
  }
  100% {
    background-position: 100% 40%;
  }
}

@keyframes generating-glow-drift {
  from {
    transform: translate3d(-8%, -4%, 0) scale(0.92) rotate(-5deg);
  }
  to {
    transform: translate3d(12%, 9%, 0) scale(1.12) rotate(8deg);
  }
}

@keyframes generating-shimmer {
  0%,
  18% {
    transform: translateX(0) skewX(-14deg);
  }
  78%,
  100% {
    transform: translateX(430%) skewX(-14deg);
  }
}
</style>
