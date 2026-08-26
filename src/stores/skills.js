import { defineStore } from 'pinia'
import {
  deleteCustomSkill,
  getCustomSkillDetail,
  listCanvasSkills,
  saveCustomSkill
} from '../services/localBridge'

export const useSkillStore = defineStore('skills', {
  state: () => ({
    items: [],
    loading: false
  }),
  actions: {
    async load() {
      this.loading = true
      try {
        this.items = await listCanvasSkills()
        return this.items
      } finally {
        this.loading = false
      }
    },
    async detail(id) {
      return getCustomSkillDetail(id)
    },
    async save(input) {
      await saveCustomSkill(input)
      return this.load()
    },
    async remove(id) {
      await deleteCustomSkill(id)
      return this.load()
    }
  }
})
