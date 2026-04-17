import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adminRequest } from '../api'

export function useDeleteAlias() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (source) => adminRequest(`/api/v1/platform/mail/aliases/${encodeURIComponent(source)}`, {
      method: 'DELETE',
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['aliases'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] })
    },
  })
}
