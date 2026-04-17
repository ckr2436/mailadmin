import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adminRequest } from '../api'

export function useAdminLogin() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ username, password }) => {
      await adminRequest('/api/v1/platform/auth/login', {
        method: 'POST',
        body: { username, password },
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['adminSession'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] })
    },
  })
}
