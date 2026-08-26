<template>
  <section class="page projects">
    <div class="projects__toolbar">
      <div class="projects__filters">
        <a-input
          v-model:value="store.query"
          allow-clear
          size="large"
          placeholder="搜索本地项目"
          class="projects__search"
        >
          <template #prefix><SearchOutlined /></template>
        </a-input>
        <a-select v-model:value="store.sortOrder" size="large" class="projects__sort">
          <a-select-option value="updated_desc">最近修改</a-select-option>
          <a-select-option value="created_asc">最早创建</a-select-option>
          <a-select-option value="name_asc">名称 A–Z</a-select-option>
        </a-select>
      </div>
      <span class="projects__count">{{ store.filteredItems.length }} 个项目</span>
    </div>

    <a-spin :spinning="store.loading">
      <div v-if="!store.loading && store.query && !store.filteredItems.length" class="empty-panel">
        <div>
          <div class="empty-panel__icon"><FolderAddOutlined /></div>
          <h2>没有匹配的项目</h2>
          <p>换一个关键词试试。</p>
        </div>
      </div>

      <div v-else class="project-grid">
        <button class="project-create-card" type="button" @click="handleCreate">
          <PlusOutlined />
          <span>开始创作</span>
        </button>

        <article
          v-for="card in projectCards"
          :key="card.project.id"
          class="project-card"
          @click="openProject(card.project.id)"
        >
          <div
            class="project-card__preview"
            :class="{ 'project-card__preview--has-cover': card.coverUrl }"
          >
            <img
              v-if="card.coverUrl"
              class="project-card__cover"
              :src="card.coverUrl"
              :alt="`${card.project.name} 封面`"
              @error="handleCoverError(card.project.id)"
            />
            <template v-else>
              <div class="project-card__grid" />
              <AppstoreOutlined class="project-card__placeholder" />
            </template>
            <div class="project-card__stats">
              <template v-if="card.stats.total">
                <span v-if="card.stats.image"> <PictureOutlined /> {{ card.stats.image }} </span>
                <span v-if="card.stats.video">
                  <VideoCameraOutlined /> {{ card.stats.video }}
                </span>
                <span v-if="card.stats.audio"> <AudioOutlined /> {{ card.stats.audio }} </span>
              </template>
              <span v-else>空项目</span>
            </div>
          </div>

          <div class="project-card__body">
            <div class="project-card__copy">
              <strong>{{ card.project.name }}</strong>
              <span>{{ formatDate(card.project.updatedAt) }}</span>
            </div>

            <a-dropdown :trigger="['click']">
              <button class="icon-button project-card__menu" type="button" @click.stop>
                <MoreOutlined />
              </button>
              <template #overlay>
                <a-menu>
                  <a-menu-item @click="promptRename(card.project)">重命名</a-menu-item>
                  <a-menu-item @click="handleDuplicate(card.project.id)">创建副本</a-menu-item>
                  <a-menu-divider />
                  <a-menu-item danger @click="promptDelete(card.project)">删除项目</a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </div>
        </article>
      </div>
    </a-spin>
  </section>
</template>

<script setup>
import { computed, h, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Input, Modal, message } from 'ant-design-vue'
import {
  AppstoreOutlined,
  AudioOutlined,
  FolderAddOutlined,
  MoreOutlined,
  PictureOutlined,
  PlusOutlined,
  SearchOutlined,
  VideoCameraOutlined
} from '@ant-design/icons-vue'
import { useProjectsStore } from '../stores/projects'
import { readProjectStats } from '../domain/projects'
import { deleteProject, localAssetUrl } from '../services/localBridge'

const store = useProjectsStore()
const router = useRouter()
const failedCoverIds = ref(new Set())
if (import.meta.hot) Modal.destroyAll()
const projectCards = computed(() =>
  store.filteredItems.map((project) => ({
    project,
    stats: readProjectStats(project),
    coverUrl: failedCoverIds.value.has(project.id)
      ? ''
      : localAssetUrl({ absolutePath: project.coverAbsolutePath })
  }))
)

onMounted(async () => {
  try {
    await store.load()
  } catch (error) {
    message.error(error.message)
  }
})

async function handleCreate() {
  try {
    const project = await store.create()
    openProject(project.id)
  } catch (error) {
    message.error(error.message)
  }
}

function openProject(id) {
  router.push({ name: 'canvas', params: { id } })
}

function promptRename(project) {
  let value = project.name
  Modal.confirm({
    title: '重命名项目',
    content: () =>
      h(Input, {
        value,
        maxlength: 80,
        autofocus: true,
        'onUpdate:value': (next) => {
          value = next
        }
      }),
    async onOk() {
      const name = value.trim()
      if (!name) throw new Error('项目名称不能为空')
      await store.rename(project.id, name)
    }
  })
}

async function handleDuplicate(id) {
  try {
    await store.duplicate(id)
    message.success('已创建项目副本')
  } catch (error) {
    message.error(error.message)
  }
}

function promptDelete(project) {
  Modal.confirm({
    title: `删除“${project.name}”？`,
    content: '项目将从项目列表中移除。',
    okText: '删除',
    cancelText: '取消',
    okButtonProps: { danger: true },
    async onOk() {
      try {
        if (typeof store.remove === 'function') {
          await store.remove(project.id)
        } else {
          await deleteProject(project.id)
          await store.load()
        }
        const nextFailed = new Set(failedCoverIds.value)
        nextFailed.delete(project.id)
        failedCoverIds.value = nextFailed
        message.success('项目已删除')
      } catch (error) {
        message.error(`删除失败：${error?.message || error}`)
        throw error
      }
    }
  })
}

function handleCoverError(projectId) {
  failedCoverIds.value = new Set([...failedCoverIds.value, projectId])
}

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}
</script>

<style scoped>
.projects__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 22px;
}

.projects__search {
  max-width: 420px;
}

.projects__filters {
  display: flex;
  min-width: 0;
  flex: 1;
  gap: 10px;
}

.projects__search {
  flex: 1;
}

.projects__sort {
  width: 138px;
}

.projects__count {
  color: var(--text-secondary);
  font-size: 13px;
}

.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 18px;
}

.project-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border-soft);
  border-radius: 16px;
  background: var(--surface);
  cursor: pointer;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.02);
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.project-card:hover,
.project-create-card:hover {
  transform: translateY(-3px);
  border-color: rgba(22, 216, 199, 0.35);
  box-shadow: var(--shadow);
}

.project-create-card {
  display: grid;
  place-content: center;
  place-items: center;
  gap: 12px;
  min-width: 0;
  min-height: 224px;
  padding: 24px;
  border: 1px solid var(--border);
  border-radius: 16px;
  color: var(--text);
  background: var(--surface-raised);
  cursor: pointer;
  font-weight: 600;
  text-align: center;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.02);
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    background 160ms ease,
    box-shadow 160ms ease;
}

.project-create-card:hover {
  background: var(--surface-soft);
}

.project-create-card:focus-visible {
  outline: 3px solid var(--primary-soft);
  outline-offset: 3px;
  border-color: var(--primary);
}

.project-create-card :deep(.anticon) {
  color: var(--text-secondary);
  font-size: 24px;
}

.project-card__preview {
  position: relative;
  display: grid;
  place-items: center;
  height: 158px;
  overflow: hidden;
  border-bottom: 1px solid var(--border-soft);
  background:
    radial-gradient(circle at 55% 40%, rgba(22, 216, 199, 0.15), transparent 32%), var(--preview-bg);
}

.project-card__grid {
  position: absolute;
  inset: 0;
  opacity: 0.28;
  background-image:
    linear-gradient(var(--preview-grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--preview-grid-line) 1px, transparent 1px);
  background-size: 20px 20px;
}

.project-card__placeholder {
  position: relative;
  color: rgba(110, 235, 225, 0.58);
  font-size: 42px;
}

.project-card__cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.project-card__preview--has-cover::after {
  position: absolute;
  inset: auto 0 0;
  height: 44%;
  background: linear-gradient(transparent, rgba(3, 8, 12, 0.42));
  content: '';
  pointer-events: none;
}

.project-card__stats {
  position: absolute;
  right: 11px;
  bottom: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
  padding: 4px 8px;
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  color: var(--text-secondary);
  background: var(--preview-stats-bg);
  font-size: 10px;
  backdrop-filter: blur(8px);
}

.project-card__preview--has-cover .project-card__stats {
  z-index: 1;
  border-color: rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.82);
  background: rgba(5, 9, 13, 0.72);
}

.project-card__stats span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.project-card__body {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 15px 14px 15px 17px;
}

.project-card__copy {
  display: grid;
  min-width: 0;
  gap: 5px;
}

.project-card__copy strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-card__copy span {
  color: var(--text-secondary);
  font-size: 12px;
}

.project-card__menu {
  width: 34px;
  height: 34px;
  margin-left: auto;
}

.empty-panel__icon {
  margin-bottom: 12px;
  color: var(--primary);
  font-size: 42px;
}

.empty-panel h2 {
  margin: 0;
  color: var(--text);
}

.empty-panel p {
  margin: 9px 0 20px;
}
</style>
