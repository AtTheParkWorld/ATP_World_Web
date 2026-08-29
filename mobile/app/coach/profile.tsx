/**
 * Coach profile editor (founder 2026-09-17: "if I'm a coach I should be
 * able to edit my coach profile on the app as well, same features as
 * the website").
 *
 * Full parity with the web editor: identity, story, credentials, photos
 * (profile / cover / intro video / gallery), private-session settings
 * and socials. Photos matter most — none of the 17 coaches had uploaded
 * one, which is why coach cards looked empty in the app.
 *
 * PUT /coaches/:id overwrites every field it accepts, so this screen
 * always sends the complete shape seeded from the loaded profile.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCoach, updateCoachProfile } from '@/lib/api/coaches';
import { pickAndUploadMedia } from '@/lib/api/upload';
import { useAuthStore } from '@/lib/stores/auth.store';
import { absUrl } from '@/lib/utils/imageUrl';
import { colors, fontFamily } from '@/lib/theme/tokens';

const csv = (a?: string[] | null) => (a || []).join(', ');
const parseCsv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

export default function CoachProfileEditor() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.member) as any;
  const coachId = String(me?.id || '');

  const q = useQuery({
    queryKey: ['coach', coachId],
    queryFn: () => getCoach(coachId),
    enabled: !!coachId,
  });

  const [f, setF] = useState({
    display_name: '', tagline: '', bio: '', philosophy: '',
    specialties: '', certifications: '', languages: '',
    years_experience: '', private_session_info: '',
    instagram: '', tiktok: '', whatsapp_url: '', website_url: '', youtube_url: '', linkedin_url: '',
  });
  const [acceptsPrivate, setAcceptsPrivate] = useState(false);
  const [photo, setPhoto]   = useState<string | null>(null);
  const [cover, setCover]   = useState<string | null>(null);
  const [video, setVideo]   = useState<string | null>(null);
  const [gallery, setGallery] = useState<string[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);

  useEffect(() => {
    const c: any = q.data?.coach;
    if (!c) return;
    const p = c.profile || {};
    const s = c.social || {};
    setF({
      display_name: c.display_name || '',
      tagline: p.tagline || '',
      bio: p.bio || '',
      philosophy: p.philosophy || '',
      specialties: csv(p.specialties),
      certifications: csv(p.certifications),
      languages: csv(p.languages),
      years_experience: p.years_experience == null ? '' : String(p.years_experience),
      private_session_info: p.private_session_info || '',
      instagram: s.instagram || '', tiktok: s.tiktok || '',
      whatsapp_url: s.whatsapp_url || '', website_url: s.website_url || '',
      youtube_url: s.youtube_url || '', linkedin_url: s.linkedin_url || '',
    });
    setAcceptsPrivate(!!p.accepts_private_sessions);
    setPhoto(p.profile_photo_url || null);
    setCover(p.cover_image_url || null);
    setVideo(p.intro_video_url || null);
    setGallery(Array.isArray(p.gallery_urls) ? p.gallery_urls : []);
  }, [q.data]);

  async function upload(slot: 'photo' | 'cover' | 'video' | 'gallery') {
    setUploading(slot);
    try {
      // 'post' is the member-allowed upload kind that accepts both
      // images and video (see MEMBER_UPLOAD_KINDS on the backend).
      const picked = await pickAndUploadMedia({ kind: 'post' });
      if (!picked) return;
      const isVideo = picked.content_type.startsWith('video/');
      if (slot === 'video' && !isVideo) throw new Error('Pick a video for your intro clip.');
      if (slot !== 'video' && isVideo) throw new Error('Pick an image for this slot.');
      if (slot === 'photo')   setPhoto(picked.public_url);
      if (slot === 'cover')   setCover(picked.public_url);
      if (slot === 'video')   setVideo(picked.public_url);
      if (slot === 'gallery') setGallery((g) => [...g, picked.public_url].slice(0, 12));
    } catch (e) {
      Alert.alert('Upload failed', (e as Error).message || 'Try again.');
    } finally {
      setUploading(null);
    }
  }

  const saveMu = useMutation({
    mutationFn: () => updateCoachProfile(coachId, {
      display_name: f.display_name.trim() || null,
      tagline: f.tagline.trim() || null,
      bio: f.bio.trim() || null,
      philosophy: f.philosophy.trim() || null,
      cover_image_url: cover,
      profile_photo_url: photo,
      intro_video_url: video,
      specialties: parseCsv(f.specialties),
      certifications: parseCsv(f.certifications),
      languages: parseCsv(f.languages),
      gallery_urls: gallery,
      accepts_private_sessions: acceptsPrivate,
      private_session_info: f.private_session_info.trim() || null,
      instagram: f.instagram.trim() || null,
      tiktok: f.tiktok.trim() || null,
      whatsapp_url: f.whatsapp_url.trim() || null,
      website_url: f.website_url.trim() || null,
      youtube_url: f.youtube_url.trim() || null,
      linkedin_url: f.linkedin_url.trim() || null,
      years_experience: f.years_experience ? parseInt(f.years_experience, 10) : null,
    }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['coach', coachId] });
      await qc.invalidateQueries({ queryKey: ['coaches'] });
      Alert.alert('Saved', 'Your coach profile is updated.');
      router.back();
    },
    onError: (e) => Alert.alert('Could not save', (e as Error).message || 'Try again.'),
  });

  if (!coachId) return null;

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <View className="px-5 pt-2 pb-3 flex-row items-center justify-between border-b border-white/5">
          <Pressable onPress={() => router.back()} className="py-2 -ml-2">
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }}>Cancel</Text>
          </Pressable>
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase">
            Coach profile
          </Text>
          <Pressable
            onPress={() => saveMu.mutate()}
            disabled={saveMu.isPending}
            className={`px-4 py-2 rounded-atp ${saveMu.isPending ? 'bg-atp-dark-3' : 'bg-atp-green active:opacity-80'}`}
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-sm uppercase tracking-widest">
              {saveMu.isPending ? 'Saving…' : 'Save'}
            </Text>
          </Pressable>
        </View>

        {q.isLoading ? (
          <ActivityIndicator color={colors.green} className="mt-10" />
        ) : (
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
            <Section label="Photos" />
            <View className="flex-row gap-3 mb-4">
              <MediaSlot label="Profile photo" uri={photo} busy={uploading === 'photo'} onPress={() => upload('photo')} onClear={() => setPhoto(null)} />
              <MediaSlot label="Cover image"  uri={cover} busy={uploading === 'cover'} onPress={() => upload('cover')} onClear={() => setCover(null)} />
            </View>
            <Pressable
              onPress={() => upload('video')}
              disabled={uploading === 'video'}
              className="bg-atp-dark border border-white/10 rounded-atp px-4 py-3 mb-4 active:opacity-80"
            >
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">
                {uploading === 'video' ? 'Uploading…' : video ? 'Replace intro video' : 'Add intro video'}
              </Text>
              {!!video && (
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[11px] mt-1" numberOfLines={1}>
                  {video}
                </Text>
              )}
            </Pressable>

            <View className="mb-5">
              <View className="flex-row items-center justify-between mb-2">
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest">
                  Gallery ({gallery.length}/12)
                </Text>
                <Pressable onPress={() => upload('gallery')} disabled={uploading === 'gallery' || gallery.length >= 12}>
                  <Text style={{ fontFamily: fontFamily.bodyBold, color: gallery.length >= 12 ? colors.muted : colors.green }} className="text-xs uppercase tracking-widest">
                    {uploading === 'gallery' ? 'Uploading…' : '+ Add'}
                  </Text>
                </Pressable>
              </View>
              {gallery.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {gallery.map((g, i) => (
                    <Pressable
                      key={g + i}
                      onLongPress={() => setGallery((arr) => arr.filter((_, idx) => idx !== i))}
                      className="mr-2"
                    >
                      <Image source={{ uri: absUrl(g)! }} style={{ width: 72, height: 72, borderRadius: 10 }} resizeMode="cover" />
                    </Pressable>
                  ))}
                </ScrollView>
              )}
              {gallery.length > 0 && (
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[10px] mt-1">
                  Long-press a photo to remove it.
                </Text>
              )}
            </View>

            <Section label="Identity" />
            <Field label="Display name" value={f.display_name} onChange={(v) => setF({ ...f, display_name: v })} />
            <Field label="Tagline" value={f.tagline} onChange={(v) => setF({ ...f, tagline: v })} />
            <Field label="Bio" value={f.bio} onChange={(v) => setF({ ...f, bio: v })} multiline />
            <Field label="Philosophy" value={f.philosophy} onChange={(v) => setF({ ...f, philosophy: v })} multiline />

            <Section label="Credentials" />
            <Field label="Specialties (comma separated)" value={f.specialties} onChange={(v) => setF({ ...f, specialties: v })} />
            <Field label="Certifications (comma separated)" value={f.certifications} onChange={(v) => setF({ ...f, certifications: v })} />
            <Field label="Languages (comma separated)" value={f.languages} onChange={(v) => setF({ ...f, languages: v })} />
            <Field label="Years of experience" value={f.years_experience} onChange={(v) => setF({ ...f, years_experience: v })} keyboardType="number-pad" />

            <Section label="Private sessions" />
            <Pressable onPress={() => setAcceptsPrivate((p) => !p)} className="flex-row items-center gap-3 mb-3">
              <View
                className="items-center justify-center rounded"
                style={{ width: 22, height: 22, borderWidth: 1.5, borderColor: acceptsPrivate ? colors.green : 'rgba(255,255,255,0.35)', backgroundColor: acceptsPrivate ? colors.green : 'transparent' }}
              >
                {acceptsPrivate && <Text style={{ color: colors.black, fontFamily: fontFamily.bodyBold, fontSize: 14 }}>✓</Text>}
              </View>
              <Text style={{ fontFamily: fontFamily.body, color: colors.white }} className="text-sm flex-1">
                I accept 1-on-1 private sessions
              </Text>
            </Pressable>
            {acceptsPrivate && (
              <Field label="What members should know" value={f.private_session_info} onChange={(v) => setF({ ...f, private_session_info: v })} multiline />
            )}

            <Section label="Links" />
            <Field label="Instagram" value={f.instagram} onChange={(v) => setF({ ...f, instagram: v })} />
            <Field label="TikTok" value={f.tiktok} onChange={(v) => setF({ ...f, tiktok: v })} />
            <Field label="WhatsApp link" value={f.whatsapp_url} onChange={(v) => setF({ ...f, whatsapp_url: v })} />
            <Field label="Website" value={f.website_url} onChange={(v) => setF({ ...f, website_url: v })} />
            <Field label="YouTube" value={f.youtube_url} onChange={(v) => setF({ ...f, youtube_url: v })} />
            <Field label="LinkedIn" value={f.linkedin_url} onChange={(v) => setF({ ...f, linkedin_url: v })} />
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Section({ label }: { label: string }) {
  return (
    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-[11px] uppercase tracking-widest mt-3 mb-3">
      {label}
    </Text>
  );
}

function MediaSlot({ label, uri, busy, onPress, onClear }: {
  label: string; uri: string | null; busy: boolean; onPress: () => void; onClear: () => void;
}) {
  return (
    <View className="flex-1">
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
        {label}
      </Text>
      <Pressable
        onPress={onPress}
        disabled={busy}
        className="bg-atp-dark border border-white/10 rounded-atp items-center justify-center overflow-hidden"
        style={{ height: 110 }}
      >
        {busy ? (
          <ActivityIndicator color={colors.green} />
        ) : uri ? (
          <Image source={{ uri: absUrl(uri)! }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">＋ Add</Text>
        )}
      </Pressable>
      {!!uri && !busy && (
        <Pressable onPress={onClear} className="mt-1">
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[10px] text-center">Remove</Text>
        </Pressable>
      )}
    </View>
  );
}

function Field(props: {
  label: string; value: string; onChange: (v: string) => void; multiline?: boolean; keyboardType?: any;
}) {
  return (
    <View className="mb-4">
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
        {props.label}
      </Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChange}
        multiline={props.multiline}
        keyboardType={props.keyboardType}
        autoCapitalize="sentences"
        placeholderTextColor={colors.muted}
        style={{ fontFamily: fontFamily.body, color: colors.white, minHeight: props.multiline ? 90 : undefined, textAlignVertical: props.multiline ? 'top' : 'center' }}
        className="bg-atp-dark border border-white/10 rounded-atp px-4 py-3 text-base"
      />
    </View>
  );
}
