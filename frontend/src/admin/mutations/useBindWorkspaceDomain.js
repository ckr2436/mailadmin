import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adminRequest } from '../api'

export function useBindWorkspaceDomain() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ slug, domain }) => adminRequest(`/api/v1/platform/workspaces/${encodeURIComponent(slug)}/domains`, {
      method: 'POST',
      body: { domain },
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    },
  })
}
