import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adminRequest } from '../api'
import { fetchAdminBindings } from '../hooks/useAdminBindings'

export function useSaveAdminBindings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload) => {
      const { username, workspace_slug, ...perms } = payload
      if (!username || !workspace_slug) {
        throw new Error('username 和 workspace_slug 不能为空')
      }

      const key = ['adminBindings', username]
      const existing = await queryClient.fetchQuery({
        queryKey: key,
        queryFn: async () => {
          const data = await fetchAdminBindings(username)
          return data.items || []
        },
      })

      const nextBinding = { workspace_slug, ...perms }
      const hasExisting = existing.some((item) => item.workspace_slug === workspace_slug)
      const bindings = hasExisting
        ? existing.map((item) => (item.workspace_slug === workspace_slug ? { ...item, ...nextBinding } : item))
        : [...existing, nextBinding]

      await adminRequest(`/api/v1/platform/admin-users/${encodeURIComponent(username)}/workspaces`, {
        method: 'PUT',
        body: { bindings },
      })

      return { username, bindings }
    },
    onSuccess: async ({ username, bindings }) => {
      queryClient.setQueryData(['adminBindings', username], bindings)
      await queryClient.invalidateQueries({ queryKey: ['adminUsers'] })
    },
  })
}
