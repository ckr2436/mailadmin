import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adminRequest } from '../api'

export function useSaveAdminUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload) => adminRequest('/api/v1/platform/admin-users', {
      method: 'POST',
      body: payload,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['adminUsers'] })
    },
  })
}
