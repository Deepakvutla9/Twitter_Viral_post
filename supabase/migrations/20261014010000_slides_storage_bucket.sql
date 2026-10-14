-- Public bucket for carousel slide images. Instagram's Graph API fetches each slide
-- from a public URL, and the single third-party host used before (catbox.moe)
-- timed out on uploads, which failed every post. Uploads come from the backend
-- with the service-role key; the bucket is public-read only because Instagram has
-- to fetch the files, and has no anon write policy.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('slides', 'slides', true, 5242880, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;
