import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adminRequest } from '../api'

export function useToggleAliasStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ source, active }) => adminRequest(`/api/v1/platform/mail/aliases/${encodeURIComponent(source)}/status`, {
      method: 'PATCH',
      body: { active },
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['aliases'] })
    },
  })
}
