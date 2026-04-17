import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adminRequest } from '../api'

export function useSaveWorkspace() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload) => adminRequest('/api/v1/platform/workspaces', {
      method: 'POST',
      body: payload,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] })
    },
  })
}
