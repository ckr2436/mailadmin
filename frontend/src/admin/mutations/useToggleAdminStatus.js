import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adminRequest } from '../api'

export function useToggleAdminStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ username, active }) => adminRequest(`/api/v1/platform/admin-users/${encodeURIComponent(username)}/status`, {
      method: 'PATCH',
      body: { active },
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['adminUsers'] })
    },
  })
}
