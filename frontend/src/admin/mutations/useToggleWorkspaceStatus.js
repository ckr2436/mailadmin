import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adminRequest } from '../api'

export function useToggleWorkspaceStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ slug, active }) => adminRequest(`/api/v1/platform/workspaces/${encodeURIComponent(slug)}/status`, {
      method: 'PATCH',
      body: { active },
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    },
  })
}
