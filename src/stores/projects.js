import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  createProject,
  deleteProject,
  duplicateProject,
  listProjects,
  renameProject
} from '../services/localBridge'
import { filterAndSortProjects } from '../domain/projects'

export const useProjectsStore = defineStore('projects', () => {
  const items = ref([])
  const loading = ref(false)
  const query = ref('')
  const sortOrder = ref('updated_desc')

  const filteredItems = computed(() =>
    filterAndSortProjects(items.value, query.value, sortOrder.value)
  )

  async function load() {
    loading.value = true
    try {
      items.value = await listProjects()
    } finally {
      loading.value = false
    }
  }

  async function create(name = '未命名项目') {
    const project = await createProject(name)
    items.value = [project, ...items.value]
    return project
  }

  async function rename(id, name) {
    const updated = await renameProject(id, name)
    replace(updated)
    return updated
  }

  async function duplicate(id) {
    const project = await duplicateProject(id)
    await load()
    return items.value.find((item) => item.id === project.id) || project
  }

  async function remove(id) {
    await deleteProject(id)
    items.value = items.value.filter((item) => item.id !== id)
  }

  function replace(project) {
    const index = items.value.findIndex((item) => item.id === project.id)
    if (index >= 0) items.value[index] = { ...items.value[index], ...project }
  }

  return {
    items,
    filteredItems,
    loading,
    query,
    sortOrder,
    load,
    create,
    rename,
    duplicate,
    remove
  }
})
