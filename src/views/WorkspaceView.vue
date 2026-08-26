<template>
  <div class="workspace">
    <header class="workspace__header">
      <button class="icon-button workspace__back" type="button" title="返回项目" @click="goBack">
        <ArrowLeftOutlined />
      </button>
      <div class="workspace__title">
        <strong>{{ project?.name || '正在打开项目…' }}</strong>
      </div>
    </header>

    <main ref="workspaceBodyElement" class="workspace__body">
      <a-spin v-if="loading" class="workspace__loading" />
      <VueFlow
        v-else
        v-model:nodes="nodes"
        v-model:edges="edges"
        :node-types="nodeTypes"
        :default-edge-options="defaultEdgeOptions"
        :nodes-draggable="!assistantApplying"
        :nodes-connectable="!assistantApplying"
        :elements-selectable="!assistantApplying"
        class="workspace__flow"
        @connect="handleConnect"
        @connect-start="handleConnectStart"
        @connect-end="handleConnectEnd"
        @move-end="handleViewportChanged"
        @node-click="handleNodeClick"
        @edge-click="handleEdgeClick"
        @pane-click="handlePaneClick"
        @pane-context-menu="handlePaneContextMenu"
      >
        <Background pattern-color="var(--color-canvas-grid)" :gap="24" :size="1" />
        <Controls position="bottom-left" />
      </VueFlow>

      <button
        v-if="!loading && !assistantOpen"
        class="assistant-fab"
        type="button"
        title="AI 助手"
        aria-label="打开 AI 助手"
        :aria-expanded="assistantOpen"
        @click="toggleAssistant"
      >
        <RobotOutlined />
      </button>

      <div
        v-if="canvasAddMenu.open"
        class="canvas-add-menu"
        :style="{ left: `${canvasAddMenu.left}px`, top: `${canvasAddMenu.top}px` }"
        @click.stop
        @contextmenu.prevent
      >
        <strong>添加节点</strong>
        <button type="button" @click="addMediaNodeAtMenu('image')">
          <PictureOutlined />
          AI 图片
        </button>
        <button type="button" @click="addMediaNodeAtMenu('video')">
          <VideoCameraOutlined />
          AI 视频
        </button>
        <button type="button" @click="addMediaNodeAtMenu('audio')">
          <AudioOutlined />
          AI 音频
        </button>
      </div>

      <aside v-if="assistantOpen && !loading" class="assistant-panel">
        <div class="assistant-panel__header">
          <div>
            <span class="assistant-panel__status" />
            <div>
              <strong>rsclaw助手</strong>
            </div>
          </div>
          <a-button
            class="assistant-panel__close"
            type="text"
            shape="circle"
            title="关闭"
            aria-label="关闭 AI 助手"
            @click="assistantOpen = false"
          >
            <CloseOutlined />
          </a-button>
        </div>
        <div ref="assistantMessagesElement" class="assistant-panel__messages">
          <div v-if="!assistantMessages.length" class="assistant-panel__welcome">
            <RobotOutlined />
            <strong>描述你想创作的内容</strong>
            <p>输入 @ 可提及画布节点；需要的 Skill 会根据你的描述自动调用。</p>
          </div>
          <article
            v-for="item in assistantMessageItems"
            :key="item.id"
            :class="`assistant-message assistant-message--${item.role}`"
          >
            <div class="assistant-message__content">
              <div class="assistant-message__bubble">
                <AssistantMarkdown v-if="item.role === 'assistant'" :content="item.content" />
                <template v-else>{{ item.content }}</template>
              </div>
              <section
                v-if="item.approvalRecord"
                class="assistant-approval-record"
                :class="`assistant-approval-record--${item.approvalRecord.status}`"
              >
                <header class="assistant-approval-record__header">
                  <span>
                    <strong>{{ item.approvalRecord.title || '画布生成确认' }}</strong>
                    <small v-if="item.approvalRecord.summary">
                      {{ item.approvalRecord.summary }}
                    </small>
                  </span>
                  <em>
                    <b>{{ item.approvalStatus.symbol }}</b>
                    {{ item.approvalStatus.label }}
                  </em>
                </header>
                <div v-if="item.approvalItems.length" class="assistant-role-cards">
                  <article
                    v-for="(roleCard, roleIndex) in item.approvalItems"
                    :key="`${item.id}_${roleCard.operationIndex}`"
                    class="assistant-role-card"
                  >
                    <div class="assistant-role-card__header">
                      <span>{{ roleIndex + 1 }}</span>
                      <strong>{{ roleCard.name }}</strong>
                      <em>{{ assistantApprovalOperationLabel(roleCard.operation) }}</em>
                    </div>
                    <p v-if="roleCard.detail" class="assistant-role-card__detail">
                      {{ roleCard.detail }}
                    </p>
                    <label
                      v-if="isAssistantApprovalItemActive(item.approvalRecord, roleCard)"
                      class="assistant-role-card__prompt"
                    >
                      <span>生成提示词</span>
                      <textarea
                        v-model="assistantApprovalPrompts[roleCard.operationIndex]"
                        maxlength="20000"
                        rows="5"
                        placeholder="请输入该角色卡的生成提示词"
                      />
                    </label>
                    <p v-else-if="roleCard.prompt" class="assistant-role-card__prompt-preview">
                      {{ roleCard.prompt }}
                    </p>
                  </article>
                </div>
                <p
                  v-if="item.approvalItems.some((approvalItem) => approvalItem.destructive)"
                  class="assistant-approval__warning"
                >
                  该操作包含删除内容；确认前请核对目标节点。
                </p>
                <p
                  v-if="
                    item.approvalRecord.status !== 'pending' && item.approvalRecord.resultSummary
                  "
                  class="assistant-approval-record__result"
                >
                  {{ item.approvalRecord.resultSummary }}
                </p>
                <div
                  v-if="isAssistantApprovalRecordActive(item.approvalRecord)"
                  class="assistant-approval-record__actions"
                >
                  <a-button
                    class="assistant-approval__confirm"
                    type="primary"
                    :disabled="!assistantApprovalPromptsValid"
                    :loading="assistantSending"
                    @click="reviewAssistantApproval('approve')"
                  >
                    <ThunderboltOutlined />
                    {{ assistantApprovalConfirmLabel(item.approvalRecord, item.approvalItems) }}
                  </a-button>
                  <a-button
                    class="assistant-approval__reject"
                    type="text"
                    danger
                    :disabled="assistantSending"
                    @click="reviewAssistantApproval('reject')"
                  >
                    取消
                  </a-button>
                </div>
              </section>
              <small>{{ formatAssistantTime(item.createdAt) }}</small>
            </div>
          </article>
          <article
            v-if="assistantStreamingText"
            class="assistant-message assistant-message--assistant assistant-message--streaming"
            aria-live="polite"
          >
            <div class="assistant-message__content">
              <div class="assistant-message__bubble">
                <AssistantMarkdown :content="assistantStreamingText" streaming />
              </div>
            </div>
          </article>
          <div
            v-if="assistantApproval && !assistantSending && !assistantActiveApprovalRecord"
            class="assistant-approval"
          >
            <label v-if="assistantHasEditableImagePrompt" class="assistant-prompt-editor">
              <span>AI 绘画提示词</span>
              <textarea
                v-model="assistantApprovalPrompt"
                maxlength="20000"
                rows="8"
                placeholder="请输入即将用于生成图片的提示词"
              />
              <small>{{ assistantApprovalPrompt.length }} / 20000</small>
            </label>
            <template v-else>
              <div class="assistant-approval__header">
                <span>
                  <strong>
                    {{ assistantApproval.draft?.plan?.title || assistantApprovalTitle }}
                  </strong>
                  <small>{{ assistantNeedsNodeChoice ? '节点选择' : '画布执行计划' }}</small>
                </span>
              </div>
              <div class="assistant-approval__section">
                <span class="assistant-approval__label">
                  {{ assistantNeedsNodeChoice ? '选择目标节点' : '执行说明' }}
                </span>
                <p>{{ assistantApprovalDescription }}</p>
              </div>
              <div v-if="assistantNeedsNodeChoice" class="assistant-node-choices">
                <button
                  v-for="candidate in assistantNodeCandidates"
                  :key="candidate.id"
                  type="button"
                  class="assistant-node-choice"
                  :class="{
                    'assistant-node-choice--selected': assistantNodeChoiceId === candidate.id
                  }"
                  @click="assistantNodeChoiceId = candidate.id"
                >
                  <span class="assistant-node-choice__title">
                    <b>{{ candidate.title }}</b>
                    <em>{{ candidate.type }}</em>
                  </span>
                  <small>
                    位置：{{ Math.round(candidate.position?.x || 0) }},
                    {{ Math.round(candidate.position?.y || 0) }}
                  </small>
                  <span v-if="candidate.promptPreview">{{ candidate.promptPreview }}</span>
                </button>
              </div>
              <div v-if="assistantApproval.draft" class="assistant-approval__draft">
                <span
                  v-if="assistantApproval.draft.plan?.summary"
                  class="assistant-approval__summary"
                >
                  {{ assistantApproval.draft.plan.summary }}
                </span>
                <div
                  v-if="assistantApproval.draft.plan?.steps?.length"
                  class="assistant-plan-steps"
                >
                  <span class="assistant-approval__label">计划步骤</span>
                  <ol>
                    <li v-for="step in assistantApproval.draft.plan.steps.slice(0, 5)" :key="step">
                      {{ step }}
                    </li>
                  </ol>
                </div>
                <div v-if="assistantDraftOperationLabels.length" class="assistant-workflow">
                  <span class="assistant-approval__label">
                    画布工作流（{{ assistantDraftOperationLabels.length }} 个节点）
                  </span>
                  <div class="assistant-workflow__nodes">
                    <span
                      v-for="(label, index) in assistantDraftOperationLabels"
                      :key="`${index}_${label}`"
                      class="assistant-workflow__node"
                    >
                      <i aria-hidden="true" />
                      <b>{{ label }}</b>
                      <em>{{ assistantDraftOperationTypes[index] }}</em>
                    </span>
                  </div>
                </div>
                <span
                  v-if="assistantDraftHasDestructiveOperations"
                  class="assistant-approval__warning"
                >
                  该草稿包含删除操作，确认后仍可通过 Agent 运行记录撤销。
                </span>
              </div>
            </template>
            <div class="assistant-approval__actions">
              <a-button
                v-if="assistantNeedsNodeChoice"
                class="assistant-approval__confirm"
                type="primary"
                :disabled="!assistantNodeChoiceId"
                :loading="assistantSending"
                @click="confirmAssistantNodeChoice"
              >
                <ThunderboltOutlined />
                确认选择
              </a-button>
              <a-button
                v-else
                class="assistant-approval__confirm"
                type="primary"
                :disabled="assistantHasEditableImagePrompt && !assistantApprovalPrompt.trim()"
                :loading="assistantSending"
                @click="reviewAssistantApproval('approve')"
              >
                <ThunderboltOutlined />
                {{ assistantHasEditableImagePrompt ? '确认生成' : '提交执行' }}
              </a-button>
              <a-button
                class="assistant-approval__reject"
                type="text"
                danger
                :disabled="assistantSending"
                @click="reviewAssistantApproval('reject')"
              >
                {{
                  assistantNeedsNodeChoice
                    ? '取消选择'
                    : assistantHasEditableImagePrompt
                      ? '取消'
                      : '暂不执行'
                }}
              </a-button>
            </div>
          </div>
          <div
            v-if="assistantSending"
            class="assistant-activity"
            :class="`assistant-activity--${assistantCurrentActivity?.status || 'running'}`"
            role="status"
            aria-live="polite"
          >
            <div class="assistant-activity__current">
              <span class="assistant-activity__indicator">
                <a-spin v-if="assistantCurrentActivity?.status === 'running'" size="small" />
                <span v-else>
                  {{ assistantActivityStatusSymbol(assistantCurrentActivity?.status) }}
                </span>
              </span>
              <span class="assistant-activity__copy">
                <strong>{{ assistantActivityText }}</strong>
                <span v-if="assistantCurrentActivity?.detail">
                  {{ assistantCurrentActivity.detail }}
                </span>
              </span>
              <small>{{ assistantActivityStatusText(assistantCurrentActivity?.status) }}</small>
            </div>
            <div v-if="assistantActivityHistory.length" class="assistant-activity__details">
              <span class="assistant-activity__summary">
                执行步骤（{{ assistantActivityHistory.length }}）
              </span>
              <div class="assistant-activity__history">
                <div
                  v-for="activity in assistantActivityHistory"
                  :key="activity.id"
                  class="assistant-activity__item"
                >
                  <span
                    class="assistant-activity__history-icon"
                    :class="`assistant-activity__history-icon--${activity.status}`"
                  >
                    {{ assistantActivityStatusSymbol(activity.status) }}
                  </span>
                  <span>{{ activity.label }}</span>
                  <em>{{ assistantActivityStatusText(activity.status) }}</em>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="assistant-panel__composer">
          <div
            class="assistant-panel__input-shell"
            :class="{
              'assistant-panel__input-shell--disabled': assistantSending || assistantApproval
            }"
            @keydown="handleAssistantInputKeydown"
          >
            <a-mentions
              v-model:value="assistantInput"
              class="assistant-panel__input"
              :options="assistantNodeMentionOptions"
              :filter-option="filterNodeMention"
              :rows="4"
              placement="top"
              placeholder="描述需求，输入 @ 提及节点；Enter 发送，Shift+Enter 换行"
              :disabled="assistantSending || Boolean(assistantApproval)"
              aria-label="给 rsclaw 助手发送消息"
            >
              <template #option="{ label, kindLabel, description }">
                <div class="assistant-node-option">
                  <span>
                    <strong>{{ label }}</strong>
                    <em>{{ kindLabel }}</em>
                  </span>
                  <small>{{ description || '提及此画布节点' }}</small>
                </div>
              </template>
            </a-mentions>
          </div>
          <div class="assistant-panel__composer-actions">
            <a-tooltip title="清除对话">
              <a-button
                class="assistant-panel__clear"
                type="text"
                shape="circle"
                aria-label="清除对话"
                :disabled="assistantSending || Boolean(assistantApproval)"
                @click="clearAssistant"
              >
                <DeleteOutlined />
              </a-button>
            </a-tooltip>
            <a-tooltip title="图片默认设置">
              <a-button
                class="assistant-panel__settings"
                type="text"
                shape="circle"
                aria-label="设置默认图片模型和清晰度"
                @click="openAssistantSettings"
              >
                <SettingOutlined />
              </a-button>
            </a-tooltip>
            <a-select
              v-model:value="assistantModelSelection"
              class="assistant-panel__model-select"
              :options="assistantModelSelectOptions"
              placeholder="选择文本模型"
              aria-label="助手文本模型"
            />
            <a-tooltip :title="assistantSendTooltip">
              <a-button
                class="assistant-panel__send"
                :class="{ 'assistant-panel__send--running': assistantSending }"
                type="primary"
                shape="circle"
                :aria-label="assistantSending ? '停止执行' : '发送'"
                :disabled="assistantSending ? assistantStopping : !canSendAssistant"
                @click="assistantSending ? stopAssistant() : sendAssistant()"
              >
                <span v-if="assistantSending" class="assistant-panel__stop-icon" />
                <ArrowUpOutlined v-else />
              </a-button>
            </a-tooltip>
          </div>
        </div>
      </aside>
    </main>

    <a-modal
      v-model:open="assistantSettingsOpen"
      title="AI 助手设置"
      ok-text="保存"
      cancel-text="取消"
      width="420px"
      :ok-button-props="{ disabled: !canSaveAssistantSettings }"
      @ok="saveAssistantSettings"
    >
      <div class="assistant-settings">
        <p>用于 AI 助手创建图片节点。你在对话中明确指定模型或清晰度时，以本次要求为准。</p>
        <label>
          <span>默认图片模型</span>
          <a-select
            v-model:value="assistantSettingsModelSelection"
            :options="assistantImageModelSelectOptions"
            placeholder="选择图片模型"
            aria-label="默认图片模型"
          />
        </label>
        <label>
          <span>默认清晰度</span>
          <a-select
            v-model:value="assistantSettingsResolution"
            :options="assistantImageResolutionSelectOptions"
            :disabled="!assistantSettingsModelSelection"
            placeholder="选择清晰度"
            aria-label="默认图片清晰度"
          />
        </label>
        <small v-if="assistantSettingsImageChoice">
          供应商：{{ assistantSettingsImageChoice.providerName }}
        </small>
        <a-empty
          v-if="!assistantImageModelOptions.length"
          :image="null"
          description="请先在供应商设置中添加并启用图片模型"
        />
      </div>
    </a-modal>

    <div
      v-if="previewOpen && previewMedia?.kind === 'image'"
      ref="imagePreviewDialogElement"
      class="image-viewer"
      role="dialog"
      aria-modal="true"
      :aria-label="`${previewMedia.title || '图片'}预览`"
      tabindex="-1"
    >
      <header class="image-viewer__header">
        <div class="image-viewer__title">
          <strong :title="previewMedia.title">{{ previewMedia.title || '图片预览' }}</strong>
          <small>滚轮缩放 · 放大后拖动查看</small>
        </div>
        <button
          class="image-viewer__icon-button"
          type="button"
          title="关闭 (Esc)"
          aria-label="关闭图片预览"
          @click="closeMediaPreview"
        >
          <CloseOutlined />
        </button>
      </header>

      <div
        ref="imagePreviewStageElement"
        class="image-viewer__stage"
        :class="{
          'image-viewer__stage--zoomed': imagePreviewTransform.scale > 1,
          'image-viewer__stage--dragging': imagePreviewTransform.dragging
        }"
        @click.self="handleImagePreviewStageClick"
        @dblclick="resetImagePreview"
        @wheel.prevent="handleImagePreviewWheel"
        @pointerdown="startImagePreviewDrag"
        @pointermove="moveImagePreview"
        @pointerup="stopImagePreviewDrag"
        @pointercancel="stopImagePreviewDrag"
      >
        <img
          class="image-viewer__image"
          :src="previewMedia.url"
          :alt="previewMedia.title"
          :style="imagePreviewStyle"
          draggable="false"
          @click.stop
        />
      </div>

      <div class="image-viewer__controls" @dblclick.stop>
        <button
          class="image-viewer__control-button"
          type="button"
          title="缩小"
          aria-label="缩小图片"
          :disabled="imagePreviewTransform.scale <= IMAGE_PREVIEW_MIN_SCALE"
          @click="zoomImagePreview(-IMAGE_PREVIEW_SCALE_STEP)"
        >
          <ZoomOutOutlined />
        </button>
        <button
          class="image-viewer__scale"
          type="button"
          title="恢复适应窗口"
          @click="resetImagePreview"
        >
          {{ imagePreviewScaleLabel }}
        </button>
        <button
          class="image-viewer__control-button"
          type="button"
          title="放大"
          aria-label="放大图片"
          :disabled="imagePreviewTransform.scale >= IMAGE_PREVIEW_MAX_SCALE"
          @click="zoomImagePreview(IMAGE_PREVIEW_SCALE_STEP)"
        >
          <ZoomInOutlined />
        </button>
        <span class="image-viewer__divider" />
        <button class="image-viewer__fit-button" type="button" @click="resetImagePreview">
          适应窗口
        </button>
      </div>
    </div>

    <a-modal
      v-if="previewMedia?.kind === 'video'"
      v-model:open="previewOpen"
      :title="previewMedia.title || '素材预览'"
      :footer="null"
      width="min(920px, calc(100vw - 48px))"
      @after-close="previewMedia = null"
    >
      <div class="media-preview">
        <video :src="previewMedia.url" controls autoplay />
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import {
  computed,
  markRaw,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  reactive,
  ref,
  shallowRef,
  watch
} from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import {
  AudioOutlined,
  ArrowLeftOutlined,
  ArrowUpOutlined,
  CloseOutlined,
  DeleteOutlined,
  PictureOutlined,
  RobotOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  VideoCameraOutlined,
  ZoomInOutlined,
  ZoomOutOutlined
} from '@ant-design/icons-vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import AssistantMarkdown from '../components/assistant/AssistantMarkdown.vue'
import MediaNode from '../components/canvas/MediaNode.vue'
import { currentAssistantActivity, reduceAssistantActivities } from '../domain/assistantActivity'
import {
  assistantApprovalItems,
  assistantApprovalRecord,
  assistantApprovalStatus
} from '../domain/assistantApprovals'
import {
  cloneCanvasNode,
  isTextEditingTarget,
  uniqueCanvasNodeName
} from '../domain/canvasDocument'
import {
  buildCanvasContext,
  canUseNodeAsReference,
  incomingReferenceNodes,
  nodeName,
  referenceAssetIdsForNode,
  sanitizeMediaCanvas
} from '../domain/canvasCommands'
import {
  imageResolutionOptions,
  modelChoicesForType,
  providerModels,
  providerSupportsModelType,
  selectedModelChoice
} from '../domain/providerModels'
import {
  assistantInputKeyAction,
  filterNodeMention,
  nodeMentionOptions
} from '../domain/assistantSkills'
import { isTaskCancelable } from '../domain/taskStatus'
import { useCanvasPersistence } from '../composables/useCanvasPersistence'
import {
  cancelTask,
  cancelAssistantMessage,
  cancelAssistantRun,
  clearAssistantMessages,
  chooseAndExportAsset,
  chooseAndImportAsset,
  copyImageToClipboard,
  enqueueTask,
  getAgentDraft,
  getPendingAgentApproval,
  getProject,
  listAssistantMessages,
  listAssets,
  listTasks,
  localAssetUrl,
  onAgentEvent,
  resumeAgentRun,
  sendAssistantMessage
} from '../services/localBridge'
import { useAssistantPreferencesStore } from '../stores/assistantPreferences'
import { useProviderStore } from '../stores/providers'

const route = useRoute()
const router = useRouter()
const { fitView, getViewport, screenToFlowCoordinate } = useVueFlow()
const project = ref(null)
const nodes = shallowRef([])
const edges = shallowRef([])
const loading = ref(true)
const ready = ref(false)
const assets = ref([])
const importing = ref(false)
const providerStore = useProviderStore()
const { profiles: providers } = storeToRefs(providerStore)
const assistantPreferencesStore = useAssistantPreferencesStore()
const {
  imageProviderId: preferredImageProviderId,
  imageModel: preferredImageModel,
  imageResolution: preferredImageResolution
} = storeToRefs(assistantPreferencesStore)
const tasks = ref([])
const selectedNodeId = ref('')
const selectedEdgeId = ref('')
const assistantMessages = ref([])
const assistantOpen = ref(true)
const assistantSending = ref(false)
const assistantApplying = ref(false)
const assistantStopping = ref(false)
const assistantInput = ref('')
const assistantRequestId = ref('')
const assistantApproval = ref(null)
const assistantApprovalPrompt = ref('')
const assistantApprovalPrompts = ref({})
const assistantActivities = ref([])
const assistantStreamingText = ref('')
const assistantStreamingCallId = ref('')
const assistantNodeChoiceId = ref('')
const assistantProviderId = ref('')
const assistantModel = ref('')
const assistantSettingsOpen = ref(false)
const assistantSettingsModelSelection = ref('')
const assistantSettingsResolution = ref('')
const assistantMessagesElement = ref(null)
const previewOpen = ref(false)
const previewMedia = ref(null)
const imagePreviewDialogElement = ref(null)
const imagePreviewStageElement = ref(null)
const IMAGE_PREVIEW_MIN_SCALE = 0.5
const IMAGE_PREVIEW_MAX_SCALE = 5
const IMAGE_PREVIEW_SCALE_STEP = 0.25
const imagePreviewTransform = reactive({
  scale: 1,
  x: 0,
  y: 0,
  dragging: false,
  pointerId: null,
  startClientX: 0,
  startClientY: 0,
  startX: 0,
  startY: 0,
  dragMoved: false
})
const workspaceBodyElement = ref(null)
const canvasAddMenu = reactive({
  open: false,
  left: 0,
  top: 0,
  flowX: 0,
  flowY: 0
})
const connectingFrom = ref(null)
const pendingConnection = ref(null)
const connectionLandedOnNode = ref(false)
const nodeTypes = {
  image: markRaw(MediaNode),
  video: markRaw(MediaNode),
  audio: markRaw(MediaNode)
}
provide('media-node-ui', {
  modelsForKind,
  referencesForNode,
  removeReference: removeReferenceFromNode,
  updateNode: updateNodeById,
  changeModel: changeNodeModel,
  changeSizeSpec: changeNodeSizeSpec,
  generateNode: (nodeId) => runNodeById(nodeId, true),
  importNode: importMediaForNode,
  deleteNode: deleteNodeById,
  copyImage: copyImageNodeById,
  exportNode: exportNodeById,
  previewNode: previewNodeById
})
const defaultEdgeOptions = {
  type: 'default',
  animated: false,
  style: { stroke: 'var(--color-border-secondary)', strokeWidth: 1.5 }
}
let taskTimer = null
let unsubscribeAgentEvents = () => {}
let copiedNode = null

const selectedMediaNode = computed(() => {
  const node = nodes.value.find((item) => item.id === selectedNodeId.value)
  return ['image', 'video', 'audio'].includes(node?.type) ? node : null
})
const imagePreviewStyle = computed(() => ({
  transform: `translate3d(${imagePreviewTransform.x}px, ${imagePreviewTransform.y}px, 0) scale(${imagePreviewTransform.scale})`
}))
const imagePreviewScaleLabel = computed(() => `${Math.round(imagePreviewTransform.scale * 100)}%`)
const enabledProviders = computed(() => providers.value.filter((provider) => provider.enabled))
const assistantMessageItems = computed(() =>
  assistantMessages.value.map((item) => {
    const approvalRecord = assistantApprovalRecord(item)
    return {
      ...item,
      approvalRecord,
      approvalItems: assistantApprovalItems(approvalRecord),
      approvalStatus: assistantApprovalStatus(approvalRecord)
    }
  })
)
const assistantActiveApprovalRecord = computed(
  () =>
    assistantMessageItems.value.find(
      (item) =>
        item.approvalRecord?.status === 'pending' &&
        item.approvalRecord.runId === assistantApproval.value?.runId
    )?.approvalRecord || null
)
const assistantApprovalPromptsValid = computed(() =>
  assistantEditableImageOperations.value.every((editable) =>
    String(assistantApprovalPrompts.value[editable.operationIndex] || '').trim()
  )
)
const assistantNodeMentionOptions = computed(() => nodeMentionOptions(nodes.value))
const assistantPromptContent = computed(() => assistantInput.value.trim())
const assistantModelOptions = computed(() => modelChoicesForType(enabledProviders.value, 'text'))
const assistantImageModelOptions = computed(() =>
  modelChoicesForType(enabledProviders.value, 'image')
)
const assistantImageModelSelectOptions = computed(() =>
  assistantImageModelOptions.value.map((model) => ({
    value: model.selectionId,
    label: model.label
  }))
)
const defaultAssistantImageChoice = computed(
  () =>
    selectedModelChoice(
      assistantImageModelOptions.value,
      preferredImageProviderId.value,
      preferredImageModel.value
    ) ||
    assistantImageModelOptions.value[0] ||
    null
)
const defaultAssistantImageResolution = computed(() =>
  resolveImageResolution(defaultAssistantImageChoice.value, preferredImageResolution.value)
)
const assistantSettingsImageChoice = computed(
  () =>
    assistantImageModelOptions.value.find(
      (choice) => choice.selectionId === assistantSettingsModelSelection.value
    ) || null
)
const assistantImageResolutionSelectOptions = computed(() =>
  imageResolutionsForChoice(assistantSettingsImageChoice.value).map((resolution) => ({
    value: resolution,
    label: resolution === 'auto' ? '自动' : resolution
  }))
)
const canSaveAssistantSettings = computed(() =>
  Boolean(assistantSettingsImageChoice.value && assistantSettingsResolution.value)
)
const assistantModelSelectOptions = computed(() =>
  assistantModelOptions.value.map((model) => ({
    value: model.selectionId,
    label: model.label
  }))
)
const assistantModelSelection = computed({
  get() {
    return (
      selectedModelChoice(
        assistantModelOptions.value,
        assistantProviderId.value,
        assistantModel.value
      )?.selectionId || ''
    )
  },
  set(selectionId) {
    const choice = assistantModelOptions.value.find((item) => item.selectionId === selectionId)
    assistantProviderId.value = choice?.providerId || ''
    assistantModel.value = choice?.modelId || ''
  }
})
const canSendAssistant = computed(() =>
  Boolean(
    project.value &&
    assistantPromptContent.value &&
    assistantProviderId.value &&
    assistantModel.value.trim() &&
    !assistantSending.value &&
    !assistantApproval.value
  )
)
const assistantCurrentActivity = computed(() => currentAssistantActivity(assistantActivities.value))
const assistantActivityText = computed(
  () => assistantCurrentActivity.value?.label || '正在准备这次任务'
)
const assistantActivityHistory = computed(() => {
  const currentId = assistantCurrentActivity.value?.id
  return assistantActivities.value
    .filter(
      (item) =>
        item.id !== currentId &&
        item.status !== 'running' &&
        item.label !== assistantCurrentActivity.value?.label
    )
    .slice(-3)
})
const assistantApprovalTitle = computed(() =>
  assistantNeedsNodeChoice.value
    ? '请选择目标节点'
    : assistantApproval.value?.actionRequests?.some(
          (item) => item.name === 'canvas_apply_and_generate'
        )
      ? '确认创建节点并生成图片'
      : '确认应用画布草稿'
)
const assistantApprovalDescription = computed(() => {
  if (assistantNeedsNodeChoice.value) {
    return (
      assistantNodeChoiceRequest.value?.args?.reason ||
      `“${assistantNodeChoiceRequest.value?.args?.query || ''}”匹配到多个节点，请确认要操作哪一个。`
    )
  }
  if (
    assistantApproval.value?.actionRequests?.some(
      (item) => item.name === 'canvas_apply_and_generate'
    )
  ) {
    const nodeCount = assistantApproval.value?.draft?.operations?.filter(
      (operation) => operation.op === 'createNode'
    ).length
    return `确认后将创建 ${nodeCount || '草稿中的'} 个画布节点，并立即提交图片生成任务。拒绝不会改动画布。`
  }
  const count = assistantApproval.value?.actionRequests?.length || 0
  return `AI 已暂停在执行边界，共有 ${count} 项操作等待确认。拒绝不会改动画布。`
})
const assistantNodeChoiceRequest = computed(() => {
  if (assistantApproval.value?.kind === 'node_selection') {
    return {
      name: 'node_selection',
      args: {
        query: assistantApproval.value.query,
        reason: assistantApproval.value.reason,
        candidates: assistantApproval.value.candidates || []
      }
    }
  }
  return (
    assistantApproval.value?.actionRequests?.find((item) => item.name === 'human_select_node') ||
    null
  )
})
const assistantNodeCandidates = computed(() =>
  Array.isArray(assistantNodeChoiceRequest.value?.args?.candidates)
    ? assistantNodeChoiceRequest.value.args.candidates
    : []
)
const assistantNeedsNodeChoice = computed(() => Boolean(assistantNodeChoiceRequest.value))
const assistantEditableImageOperations = computed(() => {
  const canGenerate = assistantApproval.value?.actionRequests?.some(
    (item) => item.name === 'canvas_apply_and_generate'
  )
  if (!canGenerate) return []
  const operations = assistantApproval.value?.draft?.operations || []
  return operations.flatMap((operation, operationIndex) => {
    const editable =
      (operation.op === 'createNode' && operation.kind === 'image') ||
      (operation.op === 'updateNode' && operation.updates?.prompt !== undefined)
    if (!editable) return []
    return [
      {
        operationIndex,
        prompt:
          operation.op === 'updateNode'
            ? String(operation.updates?.prompt || '')
            : String(operation.prompt || '')
      }
    ]
  })
})
const assistantEditableImageOperation = computed(
  () => assistantEditableImageOperations.value[0] || null
)
const assistantHasEditableImagePrompt = computed(() =>
  Boolean(assistantEditableImageOperation.value)
)
const assistantDraftOperationLabels = computed(() =>
  (assistantApproval.value?.draft?.operations || []).slice(0, 10).map((operation, index) => {
    const target = operation.nodeRef || operation.tempId || ''
    const labels = {
      createNode: `新建节点：${operation.name || operation.tempId || index + 1}`,
      updateNode: `更新节点：${target}`,
      moveNode: `移动节点：${target}`,
      deleteNode: `删除节点：${target}`,
      connect: `连接节点：${operation.sourceRef} → ${operation.targetRef}`
    }
    return labels[operation.op] || `画布操作 ${index + 1}`
  })
)
const assistantDraftOperationTypes = computed(() =>
  (assistantApproval.value?.draft?.operations || []).slice(0, 10).map((operation) => {
    const labels = {
      createNode: 'create',
      updateNode: 'update',
      moveNode: 'move',
      deleteNode: 'delete',
      connect: 'connect'
    }
    return labels[operation.op] || 'action'
  })
)
const assistantDraftHasDestructiveOperations = computed(() =>
  (assistantApproval.value?.draft?.operations || []).some(
    (operation) => operation.op === 'deleteNode'
  )
)
watch(
  () => {
    const editables = assistantEditableImageOperations.value
    return editables.length
      ? `${assistantApproval.value?.runId || ''}:${assistantApproval.value?.draft?.updatedAt || ''}:${JSON.stringify(editables)}`
      : ''
  },
  () => {
    assistantApprovalPrompt.value = assistantEditableImageOperation.value?.prompt || ''
    assistantApprovalPrompts.value = Object.fromEntries(
      assistantEditableImageOperations.value.map((editable) => [
        editable.operationIndex,
        editable.prompt
      ])
    )
  },
  { immediate: true }
)
const assistantSendTooltip = computed(() => {
  if (assistantStopping.value) return '正在停止'
  if (assistantSending.value) return '停止执行'
  if (!assistantPromptContent.value) return '请输入内容'
  if (!assistantProviderId.value || !assistantModel.value.trim()) return '请选择文本模型'
  return '发送'
})
onMounted(async () => {
  window.addEventListener('keydown', handleGlobalKeydown)
  unsubscribeAgentEvents = onAgentEvent(handleAgentEvent)
  await loadProject()
  taskTimer = setInterval(refreshTasks, 1200)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
  unsubscribeAgentEvents()
  clearInterval(taskTimer)
  if (assistantRequestId.value) {
    cancelAssistantMessage(assistantRequestId.value).catch(() => {})
  }
})

const { flushSave, scheduleSave } = useCanvasPersistence({
  project,
  nodes,
  edges,
  ready,
  getViewport,
  serializeNode,
  serializeEdge
})

watch(
  [nodes, edges],
  () => {
    if (ready.value) scheduleSave()
  },
  { deep: true }
)

watch(
  providers,
  () => {
    if (!ready.value) return
    if (
      !selectedModelChoice(
        assistantModelOptions.value,
        assistantProviderId.value,
        assistantModel.value
      )
    ) {
      const firstTextModel = assistantModelOptions.value[0]
      assistantProviderId.value = firstTextModel?.providerId || ''
      assistantModel.value = firstTextModel?.modelId || ''
    }
    let changed = false
    nodes.value.forEach((node) => {
      if (!['image', 'video', 'audio'].includes(node?.type)) return
      changed = reconcileMediaNodeData(node.data, node.type) || changed
    })
    if (changed) scheduleSave()
  },
  { deep: true }
)

watch(assistantSettingsImageChoice, (choice) => {
  if (!assistantSettingsOpen.value) return
  assistantSettingsResolution.value = resolveImageResolution(
    choice,
    assistantSettingsResolution.value
  )
})

async function loadProject() {
  loading.value = true
  ready.value = false
  try {
    const projectId = String(route.params.id)
    const [
      loadedProject,
      loadedAssets,
      loadedProviders,
      loadedTasks,
      loadedAssistantMessages,
      ,
      pendingApproval
    ] = await Promise.all([
      getProject(projectId),
      listAssets(projectId),
      providerStore.load(),
      listTasks(projectId),
      listAssistantMessages(projectId),
      getPendingAgentApproval(projectId)
    ])
    project.value = loadedProject
    assets.value = loadedAssets.map(withAssetUrl)
    tasks.value = loadedTasks
    assistantMessages.value = loadedAssistantMessages
    assistantApproval.value = await enrichAssistantApproval(pendingApproval)
    const firstTextModel = modelChoicesForType(
      loadedProviders.filter((provider) => provider.enabled !== false),
      'text'
    )[0]
    assistantProviderId.value = firstTextModel?.providerId || ''
    assistantModel.value = firstTextModel?.modelId || ''
    const graph = parseJson(project.value.canvasJson, { nodes: [], edges: [] })
    const sanitizedGraph = sanitizeMediaCanvas(graph)
    nodes.value = sanitizedGraph.nodes.map(hydrateNodeAsset)
    edges.value = sanitizedGraph.edges
    applyTaskState()
    ready.value = true
    if (sanitizedGraph.removed) scheduleSave()
  } catch (error) {
    message.error(error.message)
    goBack()
  } finally {
    loading.value = false
    if (project.value) {
      await nextTick()
      fitView({ padding: 0.18, duration: 0, maxZoom: 1 })
    }
  }
}

function toggleAssistant() {
  closeCanvasAddMenu()
  assistantOpen.value = !assistantOpen.value
  if (assistantOpen.value) {
    selectedNodeId.value = ''
    selectedEdgeId.value = ''
    nextTick(scrollAssistantToBottom)
  }
}

function openAssistantSettings() {
  const choice = defaultAssistantImageChoice.value
  assistantSettingsModelSelection.value = choice?.selectionId || ''
  assistantSettingsResolution.value = defaultAssistantImageResolution.value
  assistantSettingsOpen.value = true
}

function saveAssistantSettings() {
  const choice = assistantSettingsImageChoice.value
  const resolution = assistantSettingsResolution.value
  if (!choice || !resolution) return
  assistantPreferencesStore.setImageDefaults({
    providerId: choice.providerId,
    model: choice.modelId,
    resolution
  })
  assistantSettingsOpen.value = false
  message.success('默认图片设置已保存')
}

function handleAssistantInputKeydown(event) {
  const action = assistantInputKeyAction(event)
  if (!action) return
  event.preventDefault()
  if (action === 'send') {
    if (canSendAssistant.value) sendAssistant()
  }
}

async function sendAssistant() {
  const content = assistantPromptContent.value
  if (!content || assistantSending.value) return
  if (!assistantProviderId.value || !assistantModel.value.trim()) {
    message.warning('请先选择助手使用的文本模型')
    return
  }
  try {
    await flushSave()
  } catch (error) {
    message.error(`画布尚未保存，无法发送给 AI：${error.message}`)
    return
  }
  const temporaryMessage = {
    id: `pending_${crypto.randomUUID()}`,
    projectId: project.value.id,
    role: 'user',
    content,
    createdAt: new Date().toISOString()
  }
  assistantMessages.value.push(temporaryMessage)
  assistantInput.value = ''
  const requestId = `assistant_request_${crypto.randomUUID()}`
  assistantRequestId.value = requestId
  assistantStopping.value = false
  assistantSending.value = true
  assistantActivities.value = []
  resetAssistantStream()
  await nextTick()
  scrollAssistantToBottom()
  try {
    const response = await sendAssistantMessage({
      projectId: project.value.id,
      providerId: assistantProviderId.value,
      model: assistantModel.value.trim(),
      content,
      requestId,
      canvasContextJson: JSON.stringify(
        buildCanvasContext(nodes.value, edges.value, assistantMediaModelContext())
      )
    })
    resetAssistantStream()
    if (!assistantStopping.value && assistantRequestId.value === requestId) {
      assistantApproval.value = await enrichAssistantApproval(
        response.approval ? { ...response.approval, runId: response.agentRun?.id } : null
      )
    }
    assistantMessages.value = await listAssistantMessages(project.value.id)
    await nextTick()
    scrollAssistantToBottom()
  } catch (error) {
    assistantMessages.value = await listAssistantMessages(project.value.id).catch(() =>
      assistantMessages.value.filter((item) => item.id !== temporaryMessage.id)
    )
    if (assistantStopping.value && assistantRequestId.value === requestId) {
      message.info('已停止执行')
    } else {
      message.error(error.message)
    }
  } finally {
    if (assistantRequestId.value === requestId) {
      resetAssistantStream()
      assistantRequestId.value = ''
      assistantSending.value = false
      assistantStopping.value = false
    }
  }
}

function handleAgentEvent(event) {
  if (event?.type !== 'agent.event') return
  const data = event.data
  if (data?.projectId !== project.value?.id) return
  if (assistantRequestId.value && data?.requestId && data.requestId !== assistantRequestId.value) {
    return
  }
  if (String(data?.type || '').startsWith('model.stream.')) {
    handleAssistantStreamEvent(data)
    return
  }
  assistantActivities.value = reduceAssistantActivities(assistantActivities.value, data)
  if (['run.failed', 'run.canceled'].includes(data?.type)) resetAssistantStream()
}

function assistantActivityStatusText(status) {
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '遇到问题'
  if (status === 'paused') return '需要确认'
  return '处理中'
}

function assistantActivityStatusSymbol(status) {
  if (status === 'completed') return '✓'
  if (status === 'failed') return '!'
  if (status === 'paused') return '…'
  return ''
}

function handleAssistantStreamEvent(event) {
  const callId = String(event?.payload?.callId || '')
  if (event.type === 'model.stream.started') {
    assistantStreamingCallId.value = callId
    assistantStreamingText.value = ''
    return
  }
  if (!callId || callId !== assistantStreamingCallId.value) return
  if (event.type === 'model.stream.chunk') {
    assistantStreamingText.value += String(event.payload?.delta || '')
    nextTick(scrollAssistantToBottom)
    return
  }
  if (
    event.type === 'model.stream.failed' ||
    (event.type === 'model.stream.completed' && event.payload?.hasToolCalls)
  ) {
    resetAssistantStream()
  }
}

function resetAssistantStream() {
  assistantStreamingText.value = ''
  assistantStreamingCallId.value = ''
}

async function reviewAssistantApproval(decision) {
  const approval = assistantApproval.value
  const runId = approval?.runId
  if (!approval || !runId || assistantSending.value) return
  if (assistantNeedsNodeChoice.value) {
    if (decision === 'reject') await submitAssistantReview({ canceled: true }, true)
    return
  }
  const promptEdits = assistantEditableImageOperations.value.map((editable, index) => ({
    operationIndex: editable.operationIndex,
    prompt: String(
      !assistantActiveApprovalRecord.value && index === 0
        ? assistantApprovalPrompt.value
        : assistantApprovalPrompts.value[editable.operationIndex] || ''
    ).trim()
  }))
  const decisions = approval.actionRequests.map((request) => {
    if (
      decision === 'approve' &&
      request.name === 'canvas_apply_and_generate' &&
      promptEdits.length
    ) {
      return {
        type: decision,
        promptEdits
      }
    }
    return { type: decision }
  })
  await submitAssistantReview(decisions, decision === 'reject')
}

async function confirmAssistantNodeChoice() {
  const approval = assistantApproval.value
  const request = assistantNodeChoiceRequest.value
  const selectedNodeId = assistantNodeChoiceId.value
  if (!approval || !request || !selectedNodeId || assistantSending.value) return
  await submitAssistantReview({ selectedNodeId })
}

async function submitAssistantReview(resumeValue, rejected = false) {
  const approval = assistantApproval.value
  const runId = approval?.runId
  if (!approval || !runId || assistantSending.value) return
  assistantSending.value = true
  assistantApplying.value = true
  assistantActivities.value = []
  resetAssistantStream()
  try {
    await flushSave()
    const response = await resumeAgentRun(runId, resumeValue)
    assistantApproval.value = await enrichAssistantApproval(
      response.approval ? { ...response.approval, runId: response.agentRun?.id || runId } : null
    )
    assistantNodeChoiceId.value = ''
    assistantMessages.value = await listAssistantMessages(project.value.id)
    await refreshCanvasAfterAgent({ focusNewNodes: !rejected })
    await refreshTasks()
    if (rejected && !response.approval) message.info('已取消，本次操作未应用')
  } catch (error) {
    const errorMessage = error.message
    assistantMessages.value = await listAssistantMessages(project.value.id).catch(
      () => assistantMessages.value
    )
    assistantApproval.value = await getPendingAgentApproval(project.value.id)
      .then(enrichAssistantApproval)
      .catch(() => assistantApproval.value)
    if (errorMessage.includes('画布已在审批期间发生修改')) {
      assistantApproval.value = null
      await refreshCanvasAfterAgent().catch(() => {})
    }
    message.error(errorMessage)
  } finally {
    resetAssistantStream()
    assistantSending.value = false
    assistantApplying.value = false
    await nextTick()
    scrollAssistantToBottom()
  }
}

async function refreshCanvasAfterAgent({ focusNewNodes = false } = {}) {
  const existingNodeIds = new Set(nodes.value.map((node) => node.id))
  let newNodeIds
  ready.value = false
  try {
    const latest = await getProject(project.value.id)
    const graph = sanitizeMediaCanvas(parseJson(latest.canvasJson, { nodes: [], edges: [] }))
    project.value = latest
    nodes.value = graph.nodes.map(hydrateNodeAsset)
    edges.value = graph.edges
    newNodeIds = nodes.value.filter((node) => !existingNodeIds.has(node.id)).map((node) => node.id)
  } finally {
    ready.value = true
  }
  if (focusNewNodes && newNodeIds.length) {
    await focusCanvasNodes(newNodeIds)
  }
  return newNodeIds
}

async function focusCanvasNodes(nodeIds) {
  await nextTick()
  await new Promise((resolve) => window.requestAnimationFrame(resolve))
  await fitView({
    nodes: nodeIds,
    padding: {
      top: 32,
      right: assistantOpen.value ? 454 : 32,
      bottom: 32,
      left: 32
    },
    duration: 320,
    maxZoom: 1
  })
}

async function enrichAssistantApproval(approval) {
  if (!approval) return null
  const commit = approval.actionRequests?.find((item) =>
    ['canvas_commit_draft', 'canvas_apply_and_generate'].includes(item.name)
  )
  const draftId = commit?.args?.draftId || commit?.arguments?.draftId
  if (!draftId) return approval
  const draft = await getAgentDraft(draftId).catch(() => null)
  return { ...approval, draft }
}

async function stopAssistant() {
  const requestId = assistantRequestId.value
  const runId = assistantApplying.value ? assistantApproval.value?.runId : ''
  if (!assistantSending.value || (!requestId && !runId) || assistantStopping.value) return
  assistantStopping.value = true
  const results = await Promise.allSettled([
    runId ? cancelAssistantRun(runId) : cancelAssistantMessage(requestId)
  ])
  const assistantCancellation = results[0]
  if (assistantCancellation.status === 'rejected') {
    assistantStopping.value = false
    message.error(assistantCancellation.reason?.message || String(assistantCancellation.reason))
    return
  }
  await refreshTasks()
}

async function runNodeById(nodeId, keepSelected = false) {
  const node = nodes.value.find((item) => item.id === nodeId)
  if (!node) return
  selectedNodeId.value = node.id
  await nextTick()
  const task = ['image', 'video', 'audio'].includes(node.type) ? await runSelectedMedia() : null
  if (!keepSelected) selectedNodeId.value = ''
  return task
}

async function clearAssistant() {
  if (!project.value || assistantSending.value || assistantApproval.value) return
  await clearAssistantMessages(project.value.id)
  assistantMessages.value = []
  assistantApproval.value = null
}

function scrollAssistantToBottom() {
  const element = assistantMessagesElement.value
  if (element) element.scrollTop = element.scrollHeight
}

function formatAssistantTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function isAssistantApprovalRecordActive(record) {
  return Boolean(
    record?.status === 'pending' && record.runId && record.runId === assistantApproval.value?.runId
  )
}

function isAssistantApprovalItemEditable(record, item) {
  return Boolean(
    record?.actionName === 'canvas_apply_and_generate' &&
    assistantEditableImageOperations.value.some(
      (editable) => editable.operationIndex === item?.operationIndex
    )
  )
}

function isAssistantApprovalItemActive(record, item) {
  return isAssistantApprovalRecordActive(record) && isAssistantApprovalItemEditable(record, item)
}

function assistantApprovalConfirmLabel(record, items) {
  const count = Array.isArray(items) ? items.length : 0
  if (record?.actionName === 'canvas_apply_and_generate') {
    return `确认生成 ${count} 个${record.itemLabel || '节点'}`
  }
  return '确认应用'
}

function assistantApprovalOperationLabel(operation) {
  return (
    {
      create: '新建',
      update: '修改',
      move: '移动',
      delete: '删除',
      connect: '连接'
    }[operation] || '操作'
  )
}

function addMediaNode(kind, position = null) {
  if (!['image', 'video', 'audio'].includes(kind)) return null
  closeCanvasAddMenu()
  assistantOpen.value = false
  const index = nodes.value.length
  const name = uniqueCanvasNodeName(nodes.value, kind)
  const node = {
    id: `node_${crypto.randomUUID()}`,
    type: kind,
    position: position || {
      x: 150 + (index % 4) * 310,
      y: 150 + Math.floor(index / 4) * 240
    },
    data: {
      ...mediaNodeDefaults(kind),
      title: name,
      name,
      prompt: '',
      assetId: '',
      assetKind: kind,
      assetUrl: ''
    }
  }
  nodes.value = [...nodes.value, node]
  selectedNodeId.value = node.id
  return node
}

function handlePaneClick(event) {
  if (assistantApplying.value) return
  clearSelection()
  if (Number(event?.detail || 0) >= 2) {
    openCanvasAddMenu(event)
    return
  }
  closeCanvasAddMenu()
}

function handlePaneContextMenu(event) {
  event.preventDefault()
  if (assistantApplying.value) return
  clearSelection()
  openCanvasAddMenu(event)
}

function openCanvasAddMenu(event) {
  pendingConnection.value = null
  openCanvasAddMenuAtClientPoint({
    x: Number(event.clientX),
    y: Number(event.clientY)
  })
}

function openCanvasAddMenuAtClientPoint(clientPoint) {
  const body = workspaceBodyElement.value
  if (!body) return
  const bounds = body.getBoundingClientRect()
  const point = screenToFlowCoordinate({
    x: Number(clientPoint.x),
    y: Number(clientPoint.y)
  })
  canvasAddMenu.left = Math.max(
    12,
    Math.min(Number(clientPoint.x) - bounds.left, bounds.width - 180)
  )
  canvasAddMenu.top = Math.max(
    12,
    Math.min(Number(clientPoint.y) - bounds.top, bounds.height - 174)
  )
  canvasAddMenu.flowX = point.x - 150
  canvasAddMenu.flowY = point.y - 100
  canvasAddMenu.open = true
  selectedNodeId.value = ''
  selectedEdgeId.value = ''
  assistantOpen.value = false
}

function closeCanvasAddMenu() {
  canvasAddMenu.open = false
  pendingConnection.value = null
}

function addMediaNodeAtMenu(kind) {
  const connection = pendingConnection.value
  const position = {
    x: canvasAddMenu.flowX,
    y: canvasAddMenu.flowY
  }
  const node = addMediaNode(kind, position)
  if (connection && node) {
    handleConnect({
      source: connection.nodeId,
      sourceHandle: connection.handleId || 'source',
      target: node.id,
      targetHandle: 'target'
    })
  }
}

function handleConnectStart({ nodeId, handleId, handleType }) {
  if (handleType !== 'source') return
  connectionLandedOnNode.value = false
  connectingFrom.value = {
    nodeId,
    handleId: handleId || 'source'
  }
}

function handleConnectEnd(event) {
  const connection = connectingFrom.value
  const landedOnNode = connectionLandedOnNode.value
  connectingFrom.value = null
  connectionLandedOnNode.value = false
  if (!connection) return
  if (landedOnNode) return
  const clientPoint = getClientPoint(event)
  if (!clientPoint) return
  const target = document.elementFromPoint(clientPoint.x, clientPoint.y)
  if (target?.closest('.vue-flow__node')) return
  // Vue Flow dispatches the pane click after connect-end. Defer the menu so
  // that click cannot immediately close it and clear the pending connection.
  setTimeout(() => {
    pendingConnection.value = connection
    openCanvasAddMenuAtClientPoint(clientPoint)
  }, 10)
}

function getClientPoint(event) {
  if (!event) return null
  if ('clientX' in event && 'clientY' in event) {
    return {
      x: Number(event.clientX),
      y: Number(event.clientY)
    }
  }
  const touch = event.changedTouches?.[0] || event.touches?.[0]
  return touch
    ? {
        x: Number(touch.clientX),
        y: Number(touch.clientY)
      }
    : null
}

function handleNodeClick({ node }) {
  closeCanvasAddMenu()
  selectedEdgeId.value = ''
  selectedNodeId.value = node.id
}

function handleEdgeClick({ edge }) {
  closeCanvasAddMenu()
  selectedNodeId.value = ''
  assistantOpen.value = false
  selectedEdgeId.value = edge.id
}

function clearSelection() {
  selectedNodeId.value = ''
  selectedEdgeId.value = ''
}

function updateNodeById(nodeId, field, value) {
  if (assistantApplying.value) return
  const node = nodes.value.find((item) => item.id === nodeId)
  if (!node) return
  node.data[field] = value
  if (field === 'title') node.data.name = value
  scheduleSave()
}

function modelsForKind(kind) {
  return modelChoicesForType(enabledProviders.value, kind)
}

function imageSizeSpecData(spec) {
  if (!spec) return {}
  return {
    sizeSpecId: spec.id,
    aspectRatio: spec.ratio,
    ratio: spec.ratio,
    resolution: spec.resolution,
    requestSize: spec.requestSize
  }
}

function imageSizeSpecForChoice(choice, preferred = {}) {
  const specs = Array.isArray(choice?.sizeSpecs) ? choice.sizeSpecs : []
  return (
    specs.find((spec) => spec.id === preferred.sizeSpecId) ||
    specs.find(
      (spec) => spec.ratio === preferred.ratio && spec.resolution === preferred.resolution
    ) ||
    specs.find((spec) => spec.resolution === preferred.resolution) ||
    specs.find((spec) => spec.ratio === preferred.ratio) ||
    specs[0] ||
    null
  )
}

function imageResolutionsForChoice(choice) {
  const resolutions = imageResolutionOptions(choice?.sizeSpecs)
  if (resolutions.length) return resolutions
  return choice?.sizeSpecs?.some((spec) => spec.resolution === 'auto') ? ['auto'] : []
}

function resolveImageResolution(choice, preferredResolution) {
  const resolutions = imageResolutionsForChoice(choice)
  return resolutions.includes(preferredResolution) ? preferredResolution : resolutions[0] || ''
}

function modelChoiceForNode(node) {
  return (
    modelsForKind(node?.type).find(
      (choice) =>
        choice.providerId === node?.data?.providerId && choice.modelId === node?.data?.model
    ) || null
  )
}

function assistantMediaModelContext() {
  const defaultChoice = defaultAssistantImageChoice.value
  const defaultResolution = defaultAssistantImageResolution.value
  const imageModels = modelsForKind('image').map((choice) => {
    const sizeSpecs =
      choice.selectionId === defaultChoice?.selectionId
        ? [...choice.sizeSpecs].sort(
            (left, right) =>
              Number(right.resolution === defaultResolution) -
              Number(left.resolution === defaultResolution)
          )
        : choice.sizeSpecs
    return {
      providerId: choice.providerId,
      modelId: choice.modelId,
      displayName: choice.displayName,
      sizeSpecs: sizeSpecs.slice(0, 12)
    }
  })
  return {
    imageModels,
    defaultImageModel: defaultChoice
      ? {
          providerId: defaultChoice.providerId,
          modelId: defaultChoice.modelId,
          displayName: defaultChoice.displayName,
          defaultResolution,
          sizeSpecs: defaultChoice.sizeSpecs
            .filter((spec) => spec.resolution === defaultResolution)
            .slice(0, 12)
        }
      : null
  }
}

function referencesForNode(nodeId) {
  const targetNode = nodes.value.find((node) => node.id === nodeId)
  if (!targetNode) return []
  return incomingReferenceNodes(nodes.value, edges.value, nodeId).filter((node) => {
    if (!node.data?.assetUrl) return false
    if (targetNode.type === 'image') return node.type === 'image'
    if (targetNode.type === 'video') return ['image', 'video', 'audio'].includes(node.type)
    return false
  })
}

function removeReferenceFromNode(nodeId, referenceNodeId) {
  const nextEdges = edges.value.filter(
    (edge) => !(edge.source === referenceNodeId && edge.target === nodeId)
  )
  if (nextEdges.length === edges.value.length) return
  edges.value = nextEdges
  selectedEdgeId.value = ''
  scheduleSave()
}

function changeNodeModel(nodeId, selectionId) {
  const node = nodes.value.find((item) => item.id === nodeId)
  if (!node) return
  const choice = modelsForKind(node.type).find((item) => item.selectionId === selectionId)
  node.data.providerId = choice?.providerId || ''
  node.data.model = choice?.modelId || ''
  if (node.type === 'image') {
    Object.assign(node.data, imageSizeSpecData(imageSizeSpecForChoice(choice)))
  }
  scheduleSave()
}

function changeNodeSizeSpec(nodeId, sizeSpecId) {
  const node = nodes.value.find((item) => item.id === nodeId)
  if (!node || node.type !== 'image') return
  const spec = imageSizeSpecForChoice(modelChoiceForNode(node), { sizeSpecId })
  if (!spec) return
  Object.assign(node.data, imageSizeSpecData(spec))
  scheduleSave()
}

async function importMediaForNode(nodeId) {
  selectedNodeId.value = nodeId
  await nextTick()
  await replaceSelectedMedia()
}

async function deleteNodeById(nodeId) {
  selectedNodeId.value = nodeId
  await nextTick()
  await deleteSelectedNode()
}

async function exportNodeById(nodeId) {
  selectedNodeId.value = nodeId
  await nextTick()
  await exportSelectedAsset()
}

async function copyImageNodeById(nodeId) {
  const node = nodes.value.find((item) => item.id === nodeId)
  const asset = assets.value.find((item) => item.id === node?.data?.assetId)
  if (node?.type !== 'image' || !asset) return message.error('本地图片不存在')
  try {
    await copyImageToClipboard(asset)
    message.success('图片已复制，可粘贴到支持图片的应用')
  } catch (error) {
    message.error(error.message)
  }
}

async function previewNodeById(nodeId) {
  selectedNodeId.value = nodeId
  await nextTick()
  openMediaPreview()
}

async function runSelectedMedia() {
  const node = selectedMediaNode.value
  if (!node) return
  const prompt = String(node.data.prompt || '').trim()
  const providerId = String(node.data.providerId || '')
  const model = String(node.data.model || '').trim()
  if (!prompt)
    return message.warning(node.type === 'audio' ? '请输入需要合成的文本' : '请先输入提示词')
  if (!providerId || !model) return message.warning('请先配置并选择支持该类型的模型')
  let imageSizeSpec = null
  if (node.type === 'image') {
    imageSizeSpec = imageSizeSpecForChoice(modelChoiceForNode(node), {
      sizeSpecId: node.data.sizeSpecId,
      ratio: node.data.aspectRatio || node.data.ratio,
      resolution: node.data.resolution
    })
    if (!imageSizeSpec) return message.warning('请先在模型配置中添加图片尺寸规格')
    Object.assign(node.data, imageSizeSpecData(imageSizeSpec))
  }

  const taskType = {
    image: 'image.generate',
    video: 'video.generate',
    audio: 'audio.generate'
  }[node.type]
  const request = {
    prompt,
    model,
    aspectRatio: node.type === 'image' ? imageSizeSpec.requestSize : node.data.aspectRatio || '1:1',
    ratio: node.data.ratio || 'adaptive',
    resolution: node.data.resolution,
    sizeSpecId: node.data.sizeSpecId || '',
    requestSize: imageSizeSpec?.requestSize || node.data.requestSize || '',
    duration: Number(node.data.duration || 5),
    generateAudio: Boolean(node.data.generateAudio),
    voiceId: node.data.voiceId || 'male-qn-qingse',
    speed: Number(node.data.speed || 1),
    format: node.data.format || 'mp3'
  }
  const referenceAssetIds = referenceAssetIdsForNode(nodes.value, edges.value, node)
  if (referenceAssetIds.length) request.referenceAssetIds = referenceAssetIds
  try {
    await flushSave()
    const task = await enqueueTask({
      projectId: project.value.id,
      nodeId: node.id,
      providerId,
      taskType,
      requestJson: JSON.stringify(request)
    })
    tasks.value = [task, ...tasks.value.filter((item) => item.id !== task.id)]
    Object.assign(node.data, {
      taskId: task.id,
      taskStatus: task.status,
      taskProgress: task.progress,
      taskError: ''
    })
    scheduleSave()
    return task
  } catch (error) {
    message.error(error.message)
    return null
  }
}

async function refreshTasks() {
  if (!project.value) return
  try {
    tasks.value = await listTasks(project.value.id)
    applyTaskState()
  } catch (error) {
    console.error('[workspace] refresh tasks failed', error)
  }
}

function applyTaskState() {
  const tasksById = new Map(tasks.value.map((task) => [task.id, task]))
  const latestTaskByNodeId = new Map()
  for (const task of tasks.value) {
    if (task.nodeId && !latestTaskByNodeId.has(task.nodeId)) {
      latestTaskByNodeId.set(task.nodeId, task)
    }
  }
  let changed = false
  for (const node of nodes.value) {
    const task =
      tasksById.get(node.data?.taskId) ||
      (!node.data?.taskId ? latestTaskByNodeId.get(node.id) : null)
    if (!task) continue
    const result = parseJson(task.resultJson, {})
    const resultAsset = Array.isArray(result.assets) ? result.assets[0] : null
    let asset = null
    if (resultAsset) {
      asset = withAssetUrl(resultAsset)
      const assetIndex = assets.value.findIndex((item) => item.id === asset.id)
      if (assetIndex >= 0) assets.value.splice(assetIndex, 1, asset)
      else assets.value.unshift(asset)
    }
    if (
      node.data.taskId !== task.id ||
      node.data.taskStatus !== task.status ||
      node.data.taskProgress !== task.progress ||
      node.data.taskError !== task.errorMessage ||
      (asset && node.data.assetId !== asset.id)
    ) {
      Object.assign(node.data, {
        taskId: task.id,
        taskStatus: task.status,
        taskProgress: task.progress,
        taskError: task.errorMessage || ''
      })
      if (asset) {
        Object.assign(node.data, {
          assetId: asset.id,
          assetKind: asset.kind,
          assetUrl: asset.url
        })
      }
      changed = true
    }
  }
  if (changed && ready.value) scheduleSave()
}

async function deleteSelectedNode() {
  const nodeId = selectedNodeId.value
  const node = nodes.value.find((item) => item.id === nodeId)
  if (!node) return
  const taskStatus = String(node.data?.taskStatus || '')
  if (node.data?.taskId && isTaskCancelable(taskStatus)) {
    try {
      await cancelTask(node.data.taskId)
    } catch (error) {
      console.warn('[workspace] cancel deleted node task failed', error)
    }
  }
  nodes.value = nodes.value.filter((node) => node.id !== nodeId)
  edges.value = edges.value.filter((edge) => edge.source !== nodeId && edge.target !== nodeId)
  selectedNodeId.value = ''
}

function duplicateSelectedNode() {
  const source = nodes.value.find((item) => item.id === selectedNodeId.value)
  if (!source) return
  addCopiedNode(source)
}

function copySelectedNode() {
  const source = nodes.value.find((item) => item.id === selectedNodeId.value)
  if (!source) return
  copiedNode = JSON.parse(JSON.stringify(source))
  message.success('已复制节点')
}

function pasteCopiedNode() {
  if (!copiedNode) return
  const pasted = addCopiedNode(copiedNode)
  copiedNode = JSON.parse(JSON.stringify(pasted))
}

function addCopiedNode(source) {
  const cloned = hydrateNodeAsset(cloneCanvasNode(source, `node_${crypto.randomUUID()}`))
  const name = uniqueCanvasNodeName(nodes.value, cloned.type, `${nodeName(source)}副本`)
  cloned.data.title = name
  cloned.data.name = name
  nodes.value = [...nodes.value, cloned]
  selectedNodeId.value = cloned.id
  return cloned
}

function handleGlobalKeydown(event) {
  const key = String(event.key || '').toLowerCase()
  const primary = event.ctrlKey || event.metaKey
  if (previewOpen.value && key === 'escape') {
    event.preventDefault()
    closeMediaPreview()
    return
  }
  if (previewOpen.value && previewMedia.value?.kind === 'image') {
    if (key === '+' || key === '=') {
      event.preventDefault()
      zoomImagePreview(IMAGE_PREVIEW_SCALE_STEP)
      return
    }
    if (key === '-') {
      event.preventDefault()
      zoomImagePreview(-IMAGE_PREVIEW_SCALE_STEP)
      return
    }
    if (key === '0') {
      event.preventDefault()
      resetImagePreview()
      return
    }
  }
  if (primary && key === 's') {
    event.preventDefault()
    void flushSave()
    return
  }
  if (isTextEditingTarget(event.target)) return
  if (primary && key === 'c' && selectedNodeId.value) {
    event.preventDefault()
    copySelectedNode()
    return
  }
  if (primary && key === 'v' && copiedNode) {
    event.preventDefault()
    pasteCopiedNode()
    return
  }
  if (primary && key === 'd' && selectedNodeId.value) {
    event.preventDefault()
    duplicateSelectedNode()
    return
  }
  if ((key === 'delete' || key === 'backspace') && selectedNodeId.value) {
    event.preventDefault()
    void deleteSelectedNode()
    return
  }
  if ((key === 'delete' || key === 'backspace') && selectedEdgeId.value) {
    event.preventDefault()
    edges.value = edges.value.filter((edge) => edge.id !== selectedEdgeId.value)
    selectedEdgeId.value = ''
    scheduleSave()
    return
  }
  if (key === 'escape') {
    closeCanvasAddMenu()
    selectedNodeId.value = ''
  }
}

function mediaNodeDefaults(kind) {
  const choice = modelsForKind(kind)[0] || null
  const sizeSpec = kind === 'image' ? imageSizeSpecForChoice(choice) : null
  return {
    providerId: choice?.providerId || '',
    model: choice?.modelId || '',
    aspectRatio: '1:1',
    ratio: 'adaptive',
    resolution: kind === 'video' ? '480p' : '1K',
    sizeSpecId: '',
    requestSize: '',
    duration: 5,
    generateAudio: true,
    voiceId: 'male-qn-qingse',
    speed: 1,
    format: 'mp3',
    taskId: '',
    taskStatus: 'idle',
    taskProgress: 0,
    taskError: '',
    ...(kind === 'image' ? imageSizeSpecData(sizeSpec) : {})
  }
}

async function replaceSelectedMedia() {
  const node = selectedMediaNode.value
  if (!node || !project.value || importing.value) return
  importing.value = true
  try {
    const imported = await chooseAndImportAsset(project.value.id, node.type)
    if (!imported) return
    const asset = withAssetUrl(imported)
    const existingIndex = assets.value.findIndex((item) => item.id === asset.id)
    if (existingIndex >= 0) assets.value.splice(existingIndex, 1, asset)
    else assets.value.unshift(asset)
    Object.assign(node.data, {
      title: asset.fileName,
      name: asset.fileName,
      assetId: asset.id,
      assetKind: asset.kind,
      assetUrl: asset.url,
      taskId: '',
      taskStatus: 'completed',
      taskProgress: 100,
      taskError: ''
    })
    scheduleSave()
    message.success('节点素材已替换')
  } catch (error) {
    message.error(error.message)
  } finally {
    importing.value = false
  }
}

async function exportLocalAsset(asset) {
  try {
    const path = await chooseAndExportAsset(asset)
    if (path) message.success('素材已导出')
  } catch (error) {
    message.error(error.message)
  }
}

async function exportSelectedAsset() {
  const assetId = selectedMediaNode.value?.data?.assetId
  const asset = assets.value.find((item) => item.id === assetId)
  if (!asset) return message.error('本地素材不存在')
  await exportLocalAsset(asset)
}

function openMediaPreview() {
  const node = selectedMediaNode.value
  if (!node?.data?.assetUrl) return message.error('本地素材不存在')
  previewMedia.value = {
    kind: node.type,
    url: node.data.assetUrl,
    title: nodeName(node)
  }
  resetImagePreview()
  previewOpen.value = true
  if (node.type === 'image') {
    nextTick(() => imagePreviewDialogElement.value?.focus())
  }
}

function closeMediaPreview() {
  stopImagePreviewDrag()
  previewOpen.value = false
  previewMedia.value = null
  resetImagePreview()
}

function clampImagePreviewScale(scale) {
  return Math.min(IMAGE_PREVIEW_MAX_SCALE, Math.max(IMAGE_PREVIEW_MIN_SCALE, scale))
}

function setImagePreviewScale(scale, anchor = null) {
  const previousScale = imagePreviewTransform.scale
  const nextScale = clampImagePreviewScale(scale)
  if (nextScale === previousScale) return

  if (anchor && imagePreviewStageElement.value) {
    const bounds = imagePreviewStageElement.value.getBoundingClientRect()
    const anchorX = anchor.clientX - (bounds.left + bounds.width / 2)
    const anchorY = anchor.clientY - (bounds.top + bounds.height / 2)
    const scaleRatio = nextScale / previousScale
    imagePreviewTransform.x = anchorX - (anchorX - imagePreviewTransform.x) * scaleRatio
    imagePreviewTransform.y = anchorY - (anchorY - imagePreviewTransform.y) * scaleRatio
  }

  imagePreviewTransform.scale = nextScale
  if (nextScale <= 1) {
    imagePreviewTransform.x = 0
    imagePreviewTransform.y = 0
  }
}

function zoomImagePreview(delta) {
  setImagePreviewScale(imagePreviewTransform.scale + delta)
}

function resetImagePreview() {
  imagePreviewTransform.scale = 1
  imagePreviewTransform.x = 0
  imagePreviewTransform.y = 0
  imagePreviewTransform.dragMoved = false
}

function handleImagePreviewWheel(event) {
  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12
  setImagePreviewScale(imagePreviewTransform.scale * factor, event)
}

function startImagePreviewDrag(event) {
  if (
    event.button !== 0 ||
    imagePreviewTransform.scale <= 1 ||
    !event.target.closest('.image-viewer__image')
  ) {
    return
  }
  imagePreviewTransform.dragging = true
  imagePreviewTransform.pointerId = event.pointerId
  imagePreviewTransform.startClientX = event.clientX
  imagePreviewTransform.startClientY = event.clientY
  imagePreviewTransform.startX = imagePreviewTransform.x
  imagePreviewTransform.startY = imagePreviewTransform.y
  imagePreviewTransform.dragMoved = false
  event.currentTarget.setPointerCapture(event.pointerId)
}

function moveImagePreview(event) {
  if (!imagePreviewTransform.dragging || imagePreviewTransform.pointerId !== event.pointerId) {
    return
  }
  if (
    Math.abs(event.clientX - imagePreviewTransform.startClientX) > 3 ||
    Math.abs(event.clientY - imagePreviewTransform.startClientY) > 3
  ) {
    imagePreviewTransform.dragMoved = true
  }
  imagePreviewTransform.x =
    imagePreviewTransform.startX + event.clientX - imagePreviewTransform.startClientX
  imagePreviewTransform.y =
    imagePreviewTransform.startY + event.clientY - imagePreviewTransform.startClientY
}

function stopImagePreviewDrag(event) {
  if (
    event &&
    imagePreviewTransform.pointerId !== null &&
    event.currentTarget?.hasPointerCapture?.(imagePreviewTransform.pointerId)
  ) {
    event.currentTarget.releasePointerCapture(imagePreviewTransform.pointerId)
  }
  imagePreviewTransform.dragging = false
  imagePreviewTransform.pointerId = null
}

function handleImagePreviewStageClick() {
  if (imagePreviewTransform.dragMoved) {
    imagePreviewTransform.dragMoved = false
    return
  }
  closeMediaPreview()
}

function withAssetUrl(asset) {
  return {
    ...asset,
    url: localAssetUrl(asset)
  }
}

function hydrateNodeAsset(node) {
  let baseNode = node
  if (['image', 'video', 'audio'].includes(node?.type)) {
    const defaults = mediaNodeDefaults(node.type)
    const data = { ...defaults, ...node.data }
    reconcileMediaNodeData(data, node.type)
    baseNode = { ...node, data }
  }
  const asset = assets.value.find((item) => item.id === node?.data?.assetId)
  if (!asset) return baseNode
  return {
    ...baseNode,
    data: {
      ...baseNode.data,
      assetKind: asset.kind,
      assetUrl: asset.url
    }
  }
}

function reconcileMediaNodeData(data, kind) {
  const previousProviderId = String(data.providerId || '')
  const previousModel = String(data.model || '')
  const provider =
    enabledProviders.value.find(
      (item) => item.id === previousProviderId && providerSupportsModelType(item, kind)
    ) || enabledProviders.value.find((item) => providerSupportsModelType(item, kind))
  const models = providerModels(provider, kind)
  data.providerId = provider?.id || ''
  data.model = models.some((item) => item.modelId === previousModel)
    ? previousModel
    : models[0]?.modelId || ''
  return data.providerId !== previousProviderId || data.model !== previousModel
}

function handleConnect(connection) {
  if (assistantApplying.value) return false
  const source = String(connection?.source || '').trim()
  const target = String(connection?.target || '').trim()
  if (
    !source ||
    !target ||
    source === target ||
    !nodes.value.some((node) => node.id === source) ||
    !nodes.value.some((node) => node.id === target)
  ) {
    return false
  }
  const sourceNode = nodes.value.find((node) => node.id === source)
  const targetNode = nodes.value.find((node) => node.id === target)
  if (!canUseNodeAsReference(sourceNode, targetNode)) {
    message.warning('该节点类型组合不能作为有效的参考关系')
    return false
  }
  connectionLandedOnNode.value = true
  const duplicate = edges.value.some((edge) => edge.source === source && edge.target === target)
  if (duplicate) return false
  edges.value = [
    ...edges.value,
    {
      id: `edge_${crypto.randomUUID()}`,
      source,
      target,
      sourceHandle: connection.sourceHandle || 'source',
      targetHandle: connection.targetHandle || 'target',
      type: 'default'
    }
  ]
  scheduleSave()
  return true
}

function handleViewportChanged() {
  scheduleSave()
}

function serializeNode(node) {
  const data = JSON.parse(JSON.stringify(node.data || {}))
  delete data.assetUrl
  delete data.skillId
  delete data.skillCode
  delete data.skillName
  delete data.skillGuide
  return {
    id: node.id,
    type: node.type || 'image',
    position: { x: Number(node.position?.x || 0), y: Number(node.position?.y || 0) },
    data
  }
}

function serializeEdge(edge) {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle || null,
    targetHandle: edge.targetHandle || null,
    type: edge.type || 'default'
  }
}

function parseJson(raw, fallback) {
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

async function goBack() {
  try {
    await flushSave()
    router.push({ name: 'projects' })
  } catch {
    message.error('画布尚未保存成功，已留在当前页面')
  }
}
</script>

<style scoped>
.workspace {
  display: grid;
  grid-template-rows: 66px minmax(0, 1fr);
  width: 100%;
  height: 100%;
  background: var(--color-canvas-bg);
}

.workspace__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 18px;
  border-bottom: 1px solid var(--border-soft);
  background: rgba(13, 19, 27, 0.94);
  backdrop-filter: blur(18px);
}

.workspace__back {
  width: 38px;
  height: 38px;
}

.workspace__title {
  display: flex;
  align-items: center;
}

.workspace__body {
  position: relative;
  min-width: 0;
  min-height: 0;
}

.workspace__loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

.workspace__flow {
  width: 100%;
  height: 100%;
  background: var(--color-canvas-bg);
}

.workspace__flow :deep(.vue-flow__edge-path) {
  stroke: var(--color-border-secondary);
  stroke-width: 2;
}

.workspace__flow :deep(.vue-flow__edge.selected .vue-flow__edge-path),
.workspace__flow :deep(.vue-flow__edge:hover .vue-flow__edge-path) {
  stroke: var(--color-primary);
  stroke-width: 3;
  filter: drop-shadow(0 0 8px rgba(14, 214, 202, 0.6));
}

.workspace__flow :deep(.vue-flow__arrowhead) {
  fill: var(--text-secondary);
}

.workspace__flow :deep(.vue-flow__edge.selected .vue-flow__arrowhead),
.workspace__flow :deep(.vue-flow__edge:hover .vue-flow__arrowhead) {
  fill: var(--color-primary);
}

.workspace__flow :deep(.vue-flow__connection-path) {
  stroke: var(--color-primary);
  stroke-width: 2;
  filter: drop-shadow(0 0 6px rgba(14, 214, 202, 0.45));
}

.workspace__flow :deep(.vue-flow__node:focus),
.workspace__flow :deep(.vue-flow__node:focus-visible) {
  outline: none;
}

.workspace__flow :deep(.vue-flow__controls) {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: none;
}

.workspace__flow :deep(.vue-flow__controls-button) {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 8px;
  border: 0;
  border-bottom: 1px solid var(--border);
  box-sizing: border-box;
  color: var(--text);
  background: var(--surface-raised);
}

.workspace__flow :deep(.vue-flow__controls-button:last-child) {
  border-bottom: 0;
}

.workspace__flow :deep(.vue-flow__controls-button:hover) {
  color: var(--primary);
  background: #18232f;
}

.workspace__flow :deep(.vue-flow__controls-button svg) {
  width: 15px;
  height: 15px;
  max-width: none;
  max-height: none;
  fill: currentColor;
}

.assistant-fab {
  position: absolute;
  right: 24px;
  bottom: 24px;
  z-index: 5;
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  padding: 0;
  border: 1px solid rgba(22, 216, 199, 0.42);
  border-radius: 50%;
  outline: none;
  color: #071211;
  font-size: 22px;
  background: var(--primary);
  box-shadow:
    0 12px 30px rgba(0, 0, 0, 0.38),
    0 0 0 5px rgba(22, 216, 199, 0.08);
  cursor: pointer;
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.assistant-fab:hover {
  transform: translateY(-2px);
  border-color: rgba(255, 255, 255, 0.5);
  box-shadow:
    0 16px 36px rgba(0, 0, 0, 0.44),
    0 0 0 6px rgba(22, 216, 199, 0.12);
}

.assistant-fab:focus-visible {
  box-shadow:
    0 12px 30px rgba(0, 0, 0, 0.38),
    0 0 0 3px #0a0f15,
    0 0 0 5px rgba(22, 216, 199, 0.82);
}

.assistant-fab:active {
  transform: translateY(0) scale(0.96);
}

.canvas-add-menu {
  position: absolute;
  z-index: 12;
  display: grid;
  width: 168px;
  padding: 7px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: rgba(15, 23, 33, 0.98);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(18px);
}

.canvas-add-menu strong {
  padding: 7px 9px 8px;
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 600;
}

.canvas-add-menu button {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 10px 9px;
  border: 0;
  border-radius: 8px;
  color: var(--text);
  text-align: left;
  background: transparent;
  cursor: pointer;
}

.canvas-add-menu button:hover {
  color: var(--primary);
  background: rgba(22, 216, 199, 0.08);
}

.node-panel {
  position: absolute;
  top: 16px;
  right: 16px;
  bottom: 16px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  width: min(360px, calc(100% - 32px));
  padding: 16px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: rgba(15, 22, 31, 0.97);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(20px);
}

.node-panel__field {
  display: grid;
  gap: 7px;
  margin-top: 15px;
}

.node-panel__export {
  width: 100%;
  margin-top: 10px;
}

.node-panel__field > span {
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
}

.node-panel__field textarea,
.node-panel__field input,
.node-panel__field select {
  width: 100%;
  padding: 10px 11px;
  border: 1px solid var(--border);
  border-radius: 9px;
  outline: none;
  color: var(--text);
  background: #0b1118;
}

.node-panel__field textarea {
  resize: vertical;
  line-height: 1.55;
}

.node-panel__field textarea:focus,
.node-panel__field input:focus,
.node-panel__field select:focus {
  border-color: rgba(22, 216, 199, 0.62);
}

.node-panel__actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.node-panel__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.node-panel__check {
  grid-template-columns: auto 1fr;
  align-items: center;
  align-content: end;
  padding-bottom: 10px;
  color: var(--text-secondary);
  font-size: 11px;
}

.node-panel__check > span {
  grid-column: 1 / -1;
}

.node-panel__check input {
  width: 16px;
  height: 16px;
  padding: 0;
  accent-color: var(--primary);
}

.node-panel__local-result {
  margin-top: 14px;
  padding: 10px;
  border: 1px solid rgba(88, 214, 155, 0.24);
  border-radius: 8px;
  color: #76dbaa;
  font-size: 11px;
  background: rgba(88, 214, 155, 0.06);
}

.node-panel__generate {
  flex: 1;
  justify-content: center;
}

.node-panel__error {
  margin-top: 14px;
  padding: 10px;
  border: 1px solid rgba(255, 100, 110, 0.25);
  border-radius: 8px;
  color: #ff9aa2;
  font-size: 11px;
  line-height: 1.55;
  background: rgba(255, 70, 80, 0.07);
}

.node-panel__result textarea {
  min-height: 160px;
  color: #c9dad8;
}

.node-panel__delete {
  display: flex;
  align-items: center;
  gap: 7px;
  align-self: flex-start;
  margin-top: auto;
  padding: 14px 0 0;
  border: 0;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
}

.node-panel__footer-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 16px;
}

.node-panel__footer-actions .node-panel__delete {
  margin-top: 0;
}

.node-panel__delete:hover {
  color: var(--danger);
}

.node-panel__skill {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 14px;
  padding: 9px 10px;
  border: 1px solid rgba(22, 216, 199, 0.22);
  border-radius: 9px;
  color: var(--primary);
  font-size: 11px;
  background: rgba(22, 216, 199, 0.06);
}

.node-panel__references {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}

.node-panel__references > span {
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
}

.node-panel__references > div {
  display: flex;
  gap: 6px;
  overflow-x: auto;
}

.node-panel__references button {
  flex: none;
  max-width: 190px;
  padding: 6px 8px;
  overflow: hidden;
  border: 1px solid rgba(22, 216, 199, 0.24);
  border-radius: 8px;
  color: var(--primary);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: rgba(22, 216, 199, 0.06);
  cursor: pointer;
}

.node-panel__references button:hover {
  border-color: rgba(22, 216, 199, 0.52);
  background: rgba(22, 216, 199, 0.11);
}

.node-panel__references small {
  margin: 0;
  color: var(--text-secondary);
  font-size: 10px;
  line-height: 1.6;
}

.image-viewer {
  position: fixed;
  inset: 0;
  z-index: 1000;
  overflow: hidden;
  color: #edf7f6;
  background: rgba(3, 6, 10, 0.96);
  outline: none;
  user-select: none;
  backdrop-filter: blur(18px);
}

.image-viewer::before {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 50% 45%, rgba(255, 255, 255, 0.055), transparent 42%),
    linear-gradient(rgba(255, 255, 255, 0.018) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.018) 1px, transparent 1px);
  background-size:
    auto,
    24px 24px,
    24px 24px;
  content: '';
  pointer-events: none;
}

.image-viewer__header {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 20px 24px;
  background: linear-gradient(rgba(3, 6, 10, 0.88), transparent);
  pointer-events: none;
}

.image-viewer__title {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.image-viewer__title strong {
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-viewer__title small {
  color: rgba(237, 247, 246, 0.58);
  font-size: 11px;
  line-height: 16px;
}

.image-viewer__icon-button,
.image-viewer__control-button,
.image-viewer__scale,
.image-viewer__fit-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  border: 0;
  color: rgba(237, 247, 246, 0.78);
  background: transparent;
  cursor: pointer;
  transition:
    color var(--transition-fast),
    background var(--transition-fast);
  pointer-events: auto;
}

.image-viewer__icon-button:hover,
.image-viewer__control-button:not(:disabled):hover,
.image-viewer__scale:hover,
.image-viewer__fit-button:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.1);
}

.image-viewer__icon-button:focus-visible,
.image-viewer__control-button:focus-visible,
.image-viewer__scale:focus-visible,
.image-viewer__fit-button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.image-viewer__icon-button {
  flex: 0 0 40px;
  width: 40px;
  height: 40px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-md);
  background: rgba(14, 20, 27, 0.74);
  box-shadow: var(--shadow-md);
  font-size: 16px;
}

.image-viewer__stage {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 84px 32px 104px;
  touch-action: none;
}

.image-viewer__image {
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  transform-origin: center;
  cursor: zoom-in;
  filter: drop-shadow(0 20px 40px rgba(0, 0, 0, 0.48));
  transition: transform 120ms var(--ease-out);
  will-change: transform;
}

.image-viewer__stage--zoomed .image-viewer__image {
  cursor: grab;
}

.image-viewer__stage--dragging .image-viewer__image {
  cursor: grabbing;
  transition: none;
}

.image-viewer__controls {
  position: absolute;
  bottom: 24px;
  left: 50%;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 2px;
  height: 48px;
  padding: 5px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-lg);
  background: rgba(14, 20, 27, 0.86);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.44);
  transform: translateX(-50%);
  backdrop-filter: blur(16px);
}

.image-viewer__control-button {
  width: 36px;
  border-radius: var(--radius-sm);
  font-size: 15px;
}

.image-viewer__control-button:disabled {
  color: rgba(237, 247, 246, 0.24);
  cursor: default;
}

.image-viewer__scale {
  min-width: 58px;
  padding: 0 8px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.image-viewer__divider {
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: rgba(255, 255, 255, 0.1);
}

.image-viewer__fit-button {
  padding: 0 10px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  white-space: nowrap;
}

.media-preview {
  display: grid;
  place-items: center;
  min-height: 280px;
  max-height: calc(100vh - 210px);
  overflow: hidden;
  border-radius: 12px;
  background: #070b10;
}

.media-preview img,
.media-preview video {
  display: block;
  max-width: 100%;
  max-height: calc(100vh - 210px);
  object-fit: contain;
}

@media (max-width: 640px) {
  .image-viewer__header {
    padding: 16px;
  }

  .image-viewer__title small {
    display: none;
  }

  .image-viewer__stage {
    padding: 72px 16px 92px;
  }

  .image-viewer__controls {
    bottom: 16px;
  }
}

.assistant-panel {
  position: absolute;
  top: 12px;
  right: 12px;
  bottom: 12px;
  z-index: 6;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: min(422px, calc(100% - 24px));
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
  border-radius: 16px;
  background: color-mix(in srgb, var(--surface-deep) 92%, transparent);
  box-shadow: 0 22px 70px rgba(0, 0, 0, 0.46);
  backdrop-filter: blur(24px);
}

.assistant-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 54px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-soft);
}

.assistant-panel__header > div {
  display: flex;
  align-items: center;
  gap: 10px;
}

.assistant-panel__header div div {
  display: grid;
  gap: 2px;
}

.assistant-panel__status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary);
  box-shadow: 0 0 12px color-mix(in srgb, var(--primary) 64%, transparent);
}

.assistant-panel__model-select {
  flex: 1 1 auto;
  min-width: 0;
}

.assistant-panel__model-select :deep(.ant-select-selector),
.assistant-panel__input-shell {
  background: var(--surface-inset) !important;
}

.assistant-panel__messages {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 16px 14px 20px;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

.assistant-panel__welcome {
  display: grid;
  place-items: center;
  gap: 8px;
  margin: auto 0;
  padding: 28px 16px;
  color: var(--text-secondary);
  text-align: center;
}

.assistant-panel__welcome > svg {
  color: var(--primary);
  font-size: 30px;
}

.assistant-panel__welcome p {
  margin: 0;
  font-size: 11px;
  line-height: 1.65;
}

.assistant-message {
  display: grid;
  gap: 6px;
  max-width: 88%;
}

.assistant-message__content {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.assistant-message__bubble {
  min-width: 0;
  padding: 2px 0;
  color: var(--text);
  font-size: 12px;
  line-height: 1.7;
}

.assistant-message--assistant {
  max-width: 100%;
}

.assistant-message__content > small {
  color: var(--text-secondary);
  font-size: 9px;
}

.assistant-message--user {
  align-self: flex-end;
}

.assistant-message--user .assistant-message__bubble {
  padding: 10px 13px;
  border: 1px solid var(--border-soft);
  border-radius: 12px;
  white-space: pre-wrap;
  background: color-mix(in srgb, var(--surface-raised) 78%, transparent);
}

.assistant-message--user .assistant-message__content > small {
  text-align: right;
}

.assistant-approval {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid color-mix(in srgb, var(--primary) 34%, var(--border));
  border-radius: 15px;
  background: color-mix(in srgb, var(--surface) 90%, transparent);
}

.assistant-approval-record {
  display: grid;
  gap: 10px;
  width: 100%;
  margin-top: 8px;
  padding: 11px;
  border: 1px solid color-mix(in srgb, var(--primary) 24%, var(--border-soft));
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface-raised) 94%, transparent);
}

.assistant-approval-record--approved {
  border-color: color-mix(in srgb, var(--color-success) 34%, var(--border-soft));
}

.assistant-approval-record--rejected,
.assistant-approval-record--superseded {
  border-color: var(--border-soft);
  opacity: 0.82;
}

.assistant-approval-record--failed {
  border-color: color-mix(in srgb, var(--danger) 42%, var(--border-soft));
}

.assistant-approval-record__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.assistant-approval-record__header > span {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.assistant-approval-record__header strong {
  color: var(--text);
  font-size: 11px;
}

.assistant-approval-record__header small {
  color: var(--text-secondary);
  font-size: 9px;
  line-height: 1.45;
}

.assistant-approval-record__header > em {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border-radius: 6px;
  color: var(--primary);
  font-size: 9px;
  font-style: normal;
  background: var(--primary-soft);
}

.assistant-approval-record--approved .assistant-approval-record__header > em {
  color: var(--color-success);
  background: color-mix(in srgb, var(--color-success) 10%, transparent);
}

.assistant-approval-record--rejected .assistant-approval-record__header > em,
.assistant-approval-record--superseded .assistant-approval-record__header > em {
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--surface-inset) 88%, transparent);
}

.assistant-role-cards {
  display: grid;
  gap: 8px;
}

.assistant-role-card {
  display: grid;
  gap: 8px;
  padding: 9px;
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-inset) 88%, transparent);
}

.assistant-role-card__header {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.assistant-role-card__header > span {
  display: inline-grid;
  width: 18px;
  height: 18px;
  flex: none;
  place-items: center;
  border-radius: 5px;
  color: var(--primary);
  font-size: 9px;
  background: var(--primary-soft);
}

.assistant-role-card__header strong {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--text);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-role-card__header em {
  flex: none;
  color: var(--text-secondary);
  font-size: 8px;
  font-style: normal;
}

.assistant-role-card__prompt {
  display: grid;
  gap: 5px;
}

.assistant-role-card__prompt > span {
  color: var(--text-secondary);
  font-size: 9px;
}

.assistant-role-card__prompt textarea {
  width: 100%;
  min-height: 92px;
  padding: 8px 9px;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: 7px;
  outline: none;
  color: var(--text);
  background: var(--surface-deep);
  font: inherit;
  font-size: 9px;
  line-height: 1.55;
}

.assistant-role-card__prompt textarea:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--primary-soft);
}

.assistant-role-card__prompt-preview {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 9px;
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

.assistant-role-card__detail {
  margin: 0;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.55;
}

.assistant-approval-record__result {
  margin: 0;
  padding: 7px 8px;
  border-radius: 7px;
  color: var(--text-secondary);
  font-size: 9px;
  line-height: 1.5;
  background: color-mix(in srgb, var(--surface-inset) 90%, transparent);
}

.assistant-approval-record__actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.assistant-approval__header {
  display: block;
}

.assistant-approval__header > span:last-child {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.assistant-approval__header strong {
  overflow: hidden;
  color: var(--text);
  font-size: 13px;
  font-weight: 650;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-approval__header small {
  color: var(--text-secondary);
  font-size: 10px;
}

.assistant-approval__section {
  display: grid;
  gap: 6px;
}

.assistant-approval__label,
.assistant-activity__summary {
  color: var(--text-secondary);
  font-size: 10px;
  line-height: 1.4;
}

.assistant-approval__section p {
  margin: 0;
  padding: 10px 11px;
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  color: color-mix(in srgb, var(--text) 86%, var(--text-secondary));
  font-size: 11px;
  line-height: 1.7;
  background: color-mix(in srgb, var(--surface-inset) 92%, transparent);
}

.assistant-prompt-editor {
  display: grid;
  gap: 8px;
}

.assistant-prompt-editor > span {
  color: var(--text);
  font-size: 12px;
  font-weight: 650;
}

.assistant-prompt-editor textarea {
  width: 100%;
  min-height: 154px;
  padding: 11px 12px;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: 10px;
  outline: none;
  color: var(--text);
  background: var(--surface-inset);
  font: inherit;
  font-size: 11px;
  line-height: 1.65;
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.assistant-prompt-editor textarea:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-soft);
}

.assistant-prompt-editor > small {
  color: var(--text-secondary);
  font-size: 9px;
  text-align: right;
}

.assistant-node-choices {
  display: grid;
  gap: 7px;
  max-height: 260px;
  overflow-y: auto;
}

.assistant-node-choice {
  display: grid;
  gap: 4px;
  width: 100%;
  padding: 9px 10px;
  color: var(--text-secondary);
  text-align: left;
  border: 1px solid var(--border-soft);
  border-radius: 9px;
  background: rgba(0, 0, 0, 0.14);
  cursor: pointer;
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast);
}

.assistant-node-choice:hover,
.assistant-node-choice--selected {
  border-color: rgba(22, 216, 199, 0.54);
  background: rgba(22, 216, 199, 0.09);
}

.assistant-node-choice__title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.assistant-node-choice__title b {
  color: var(--text-primary);
  font-size: 11px;
}

.assistant-node-choice__title em {
  color: var(--primary);
  font-size: 9px;
  font-style: normal;
}

.assistant-node-choice small,
.assistant-node-choice > span:last-child {
  overflow: hidden;
  font-size: 9px;
  line-height: 1.5;
  text-overflow: ellipsis;
}

.assistant-approval__draft {
  display: grid;
  gap: 12px;
  color: var(--text-secondary);
  font-size: 10px;
  line-height: 1.55;
}

.assistant-approval__summary {
  display: block;
  padding: 9px 10px;
  border-radius: 9px;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--surface-inset) 84%, transparent);
}

.assistant-plan-steps,
.assistant-workflow {
  display: grid;
  gap: 7px;
}

.assistant-plan-steps ol {
  display: grid;
  gap: 4px;
  margin: 0;
  padding-left: 18px;
}

.assistant-workflow__nodes {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.assistant-workflow__node {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  min-height: 24px;
  padding: 3px 7px;
  border: 1px solid color-mix(in srgb, var(--primary) 12%, var(--border-soft));
  border-radius: 6px;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 8%, var(--surface-inset));
}

.assistant-workflow__node i {
  width: 6px;
  height: 6px;
  flex: none;
  border: 1px solid currentColor;
  border-radius: 1px;
}

.assistant-workflow__node b {
  min-width: 0;
  overflow: hidden;
  font-size: 9px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-workflow__node em {
  flex: none;
  padding: 1px 5px;
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 8px;
  font-style: normal;
  background: color-mix(in srgb, var(--surface-raised) 88%, transparent);
}

.assistant-approval__warning {
  color: #ff9c6e;
}

.assistant-approval__actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.assistant-approval__confirm.ant-btn {
  width: 100%;
  height: 41px;
  border-color: #12b981;
  border-radius: 10px;
  color: #ffffff;
  font-size: 12px;
  font-weight: 650;
  background: #12b981;
  box-shadow: 0 7px 22px rgba(18, 185, 129, 0.16);
}

.assistant-approval__confirm.ant-btn:hover,
.assistant-approval__confirm.ant-btn:focus {
  border-color: #19c98f;
  color: #ffffff;
  background: #19c98f;
}

.assistant-approval__confirm.ant-btn:disabled {
  color: color-mix(in srgb, #ffffff 54%, transparent);
  border-color: color-mix(in srgb, #12b981 35%, var(--border));
  background: color-mix(in srgb, #12b981 32%, var(--surface-raised));
}

.assistant-approval__reject.ant-btn {
  align-self: center;
  height: 28px;
  padding-inline: 10px;
  font-size: 10px;
}

.assistant-activity {
  display: grid;
  gap: 10px;
  padding: 2px 6px 4px;
  color: var(--text-secondary);
  font-size: 11px;
}

.assistant-activity__current {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: start;
  gap: 8px;
}

.assistant-activity__indicator {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  margin-top: 0;
  color: var(--primary);
  font-size: 10px;
  font-weight: 700;
}

.assistant-activity--paused .assistant-activity__indicator {
  color: #faad14;
}

.assistant-activity--failed .assistant-activity__indicator {
  color: #ff7875;
}

.assistant-activity__indicator .ant-spin {
  transform: scale(0.72);
  line-height: 1;
}

.assistant-activity__copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.assistant-activity__copy strong {
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.55;
}

.assistant-activity__copy > span {
  color: var(--text-secondary);
  font-size: 10px;
  line-height: 1.55;
}

.assistant-activity__current > small {
  margin-top: 3px;
  color: var(--color-text-tertiary);
  font-size: 9px;
  white-space: nowrap;
}

.assistant-activity--paused .assistant-activity__current > small {
  color: #ffc53d;
}

.assistant-activity--failed .assistant-activity__current > small {
  color: #ff7875;
}

.assistant-activity__details {
  display: grid;
  gap: 7px;
  margin-left: 26px;
}

.assistant-activity__history {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.assistant-activity__item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  min-height: 24px;
  padding: 3px 7px;
  border: 1px solid color-mix(in srgb, var(--primary) 10%, var(--border-soft));
  border-radius: 6px;
  background: color-mix(in srgb, var(--primary) 7%, var(--surface-inset));
}

.assistant-activity__item > span:nth-child(2) {
  min-width: 0;
  overflow: hidden;
  color: var(--primary);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-activity__item em {
  flex: none;
  padding: 1px 5px;
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 8px;
  font-style: normal;
  background: color-mix(in srgb, var(--surface-raised) 88%, transparent);
}

.assistant-activity__history-icon {
  display: grid;
  place-items: center;
  width: 10px;
  height: 10px;
  color: #7dd87d;
  font-size: 7px;
  font-weight: 700;
}

.assistant-activity__history-icon--paused {
  color: #ffc53d;
}

.assistant-activity__history-icon--failed {
  color: #ff7875;
}

.assistant-panel__composer {
  display: grid;
  gap: 12px;
  padding: 14px;
  border-top: 1px solid var(--border-soft);
  background: var(--surface-deep);
}

.assistant-panel__input-shell {
  display: grid;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.assistant-panel__input-shell:focus-within {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-soft);
}

.assistant-panel__input-shell--disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.assistant-panel__input.ant-mentions {
  width: 100%;
  min-width: 0;
  min-height: 104px;
  padding: 0;
  border: 0;
  background: transparent !important;
  box-shadow: none !important;
  line-height: 1.55;
}

.assistant-panel__input :deep(textarea) {
  min-height: 104px;
  padding: 0;
  resize: none;
  background: transparent;
  line-height: 1.55;
}

.assistant-node-option {
  display: grid;
  gap: 2px;
  padding-block: 2px;
}

.assistant-node-option strong {
  font-size: 12px;
}

.assistant-node-option small {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-node-option > span {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.assistant-node-option em {
  flex: none;
  color: var(--primary);
  font-size: 9px;
  font-style: normal;
}

.assistant-panel__composer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.assistant-panel__clear {
  flex: none;
  color: var(--text-secondary);
}

.assistant-panel__clear:hover {
  color: var(--danger) !important;
  background: rgba(255, 107, 116, 0.08) !important;
}

.assistant-panel__settings {
  flex: none;
  color: var(--text-secondary);
}

.assistant-panel__settings:hover {
  color: var(--primary) !important;
  background: var(--primary-soft) !important;
}

.assistant-settings {
  display: grid;
  gap: 16px;
  padding: 4px 0;
}

.assistant-settings > p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.65;
}

.assistant-settings > label {
  display: grid;
  gap: 8px;
}

.assistant-settings > label > span {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
}

.assistant-settings > label :deep(.ant-select) {
  width: 100%;
}

.assistant-settings > small {
  margin-top: -8px;
  color: var(--text-tertiary);
  font-size: 11px;
}

.assistant-panel__send {
  flex: none;
}

.assistant-panel__send--running.ant-btn-primary:disabled {
  color: #0b0f14;
  border-color: #ffffff;
  background: #ffffff;
  cursor: wait;
  opacity: 1;
}

.assistant-panel__stop-icon {
  display: block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: currentColor;
}

.assistant-panel__close {
  color: var(--text-secondary);
}
</style>
