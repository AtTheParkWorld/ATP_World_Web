/**
 * Ambassador scanner — opens the camera, scans member QR codes
 * (expo-camera barcode scanner). On scan: hit /checkin → toast
 * success or duplicate-prevention error.
 *
 * Below the camera viewfinder: live roster showing who's booked +
 * who's checked in. Long-press a row → manual check-in fallback for
 * members whose phone died.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CameraView, Camera, type BarcodeScanningResult } from 'expo-camera';
import { getAttendance, checkInMember, type AttendanceRow } from '@/lib/api/ambassador';
import { getSession } from '@/lib/api/sessions';
import { colors, fontFamily, tribeColor } from '@/lib/theme/tokens';
import { absUrl } from '@/lib/utils/imageUrl';

export default function ScanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessionId = String(id || '');
  const qc = useQueryClient();

  const [permission, setPermission] = useState<boolean | null>(null);
  const scanLockRef = useRef(false);
  const scanWindowRef = useRef(new Map<string, number>());   // dedupe last-3s scans

  useEffect(() => {
    Camera.requestCameraPermissionsAsync().then((r) => setPermission(r.granted));
  }, []);

  const sessionQ = useQuery({
    queryKey: ['session', sessionId],
    queryFn:  () => getSession(sessionId).then(r => r.session),
    enabled:  !!sessionId,
  });
  const rosterQ = useQuery({
    queryKey: ['attendance', sessionId],
    queryFn:  () => getAttendance(sessionId).then(r => r.attendance),
    enabled:  !!sessionId,
    refetchInterval: 10_000,
  });

  const checkinMu = useMutation({
    mutationFn: (payload: { qr_token?: string; member_id?: string; method: 'qr' | 'manual' }) =>
      checkInMember(sessionId, payload),
    onSuccess: (res) => {
      const name = `${res.member.first_name} ${res.member.last_name}`;
      const pts  = res.points_awarded ? ` · +${res.points_awarded} pts` : '';
      const dup  = res.already_checked_in ? ' (already checked in)' : '';
      Alert.alert('✓ Checked in', `${name}${pts}${dup}`);
      qc.invalidateQueries({ queryKey: ['attendance', sessionId] });
    },
    onError: (err: any) => {
      Alert.alert('Check-in failed', err?.message || 'Try again.');
    },
  });

  function handleBarcode(result: BarcodeScanningResult) {
    if (scanLockRef.current) return;
    const data = result.data;
    if (!data) return;

    // Dedupe — same QR scanned within 3s is treated as a no-op
    const now = Date.now();
    const last = scanWindowRef.current.get(data);
    if (last && now - last < 3_000) return;
    scanWindowRef.current.set(data, now);

    scanLockRef.current = true;
    setTimeout(() => { scanLockRef.current = false; }, 1_500);

    // Backend accepts either qr_token directly or member-number prefixed
    // ATP:<member_number>. Strip prefix if present, otherwise send raw.
    const token = data.startsWith('ATP:') ? data.slice(4) : data;
    checkinMu.mutate({ qr_token: token, method: 'qr' });
  }

  function manualCheckIn(row: AttendanceRow) {
    Alert.alert(
      `Check in ${row.first_name} ${row.last_name}?`,
      'Use only when their QR isn\'t scanning (e.g., phone battery died).',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Check in', onPress: () => checkinMu.mutate({ member_id: row.member_id, method: 'manual' }) },
      ]
    );
  }

  const session = sessionQ.data;
  const roster  = rosterQ.data || [];
  const checkedIn = roster.filter((r) => r.checked_in_at).length;

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <View className="ml-2 flex-1">
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase" numberOfLines={1}>
            {session?.name || 'Session'}
          </Text>
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
            {checkedIn} / {roster.length} checked in
          </Text>
        </View>
      </View>

      {/* Camera */}
      <View style={{ height: 320, backgroundColor: '#000' }}>
        {permission === false ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm text-center">
              Camera access denied. Open Settings → ATP → Camera to enable.
            </Text>
          </View>
        ) : permission ? (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handleBarcode}
          />
        ) : (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color={colors.green} />
          </View>
        )}
        <View className="absolute top-3 left-3 bg-black/70 rounded px-2 py-0.5">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest">
            ● Scanning
          </Text>
        </View>
      </View>

      {/* Roster */}
      <ScrollView contentContainerStyle={{ paddingTop: 8, paddingBottom: 40 }}>
        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="px-5 text-xs uppercase tracking-widest mb-2 mt-2">
          Booked members
        </Text>
        {roster.map((row) => {
          const tColor = tribeColor(row.tribe_slug);
          const isCheckedIn = !!row.checked_in_at;
          return (
            <Pressable
              key={String(row.booking_id)}
              onLongPress={() => !isCheckedIn && manualCheckIn(row)}
              className={`mx-5 mb-2 rounded-atp p-3 flex-row items-center gap-3 ${isCheckedIn ? 'bg-atp-green/10 border border-atp-green/40' : 'bg-atp-dark border border-white/5'}`}
            >
              <View
                className="w-10 h-10 rounded-full bg-atp-dark-3 items-center justify-center overflow-hidden"
                style={{ borderWidth: 1, borderColor: tColor }}
              >
                {row.avatar_url
                  ? <Image source={{ uri: absUrl(row.avatar_url)! }} className="w-10 h-10" />
                  : <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }}>{row.first_name[0]}</Text>}
              </View>
              <View className="flex-1">
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">
                  {row.first_name} {row.last_name}
                </Text>
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
                  #{row.member_number}{row.tribe_name ? ` · ${row.tribe_name}` : ''}
                </Text>
              </View>
              {isCheckedIn ? (
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest">
                  ✓
                </Text>
              ) : (
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[10px]">
                  long-press for manual
                </Text>
              )}
            </Pressable>
          );
        })}
        {roster.length === 0 && (
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="px-8 text-sm text-center pt-6">
            {rosterQ.isLoading ? 'Loading roster…' : 'No bookings yet.'}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
