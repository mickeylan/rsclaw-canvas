import { createRouter, createWebHashHistory } from 'vue-router'
import DesktopShell from './components/DesktopShell.vue'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      component: DesktopShell,
      children: [
        { path: '', redirect: { name: 'projects' } },
        {
          path: 'projects',
          name: 'projects',
          component: () => import('./views/ProjectsView.vue')
        },
        {
          path: 'settings',
          redirect: { name: 'projects' }
        }
      ]
    },
    {
      path: '/canvas/:id',
      name: 'canvas',
      component: () => import('./views/WorkspaceView.vue')
    },
    { path: '/:pathMatch(.*)*', redirect: { name: 'projects' } }
  ]
})
