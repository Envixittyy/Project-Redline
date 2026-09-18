/**
 * Dear Dumbass Post Entity
 *
 * Stream-of-consciousness thought, vent, joke, or reply.
 * Stored exclusively in the client-side PrivateStore.
 */
export type DearDumbassPost = {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string | null;
  replyToId: string | null;
  deletedAt?: string | null;
};

export type DearDumbassThread = {
  post: DearDumbassPost;
  replies: DearDumbassPost[];
};
