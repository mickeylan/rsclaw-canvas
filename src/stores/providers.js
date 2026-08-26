import { defineStore } from 'pinia'
import {
  deleteProviderProfile,
  listProviderProfiles,
  saveProviderProfile
} from '../services/localBridge'

export const useProviderStore = defineStore('providers', {
  state: () => ({
    profiles: [],
    loading: false
  }),
  actions: {
    async load() {
      this.loading = true
      try {
        this.profiles = await listProviderProfiles()
        return this.profiles
      } finally {
        this.loading = false
      }
    },
    async save(input) {
      await saveProviderProfile(input)
      return this.load()
    },
    async remove(id) {
      await deleteProviderProfile(id)
      return this.load()
    }
  }
})
