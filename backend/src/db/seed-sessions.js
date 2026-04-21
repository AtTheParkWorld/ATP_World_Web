const { query } = require('./index');

const sessions = [
  { name: 'Morning Run', activity: 'Running', day_of_week: 'Monday', time: '06:00', location: 'Safa Park, Dubai', duration_minutes: 60, max_participants: 50, coach: 'ATP Coach', city: 'Dubai' },
  { name: 'HIIT Circuit', activity: 'HIIT', day_of_week: 'Tuesday', time: '06:30', location: 'Jumeirah Beach, Dubai', duration_minutes: 45, max_participants: 30, coach: 'ATP Coach', city: 'Dubai' },
  { name: 'Yoga Flow', activity: 'Yoga', day_of_week: 'Wednesday', time: '07:00', location: 'Creek Park, Dubai', duration_minutes: 60, max_participants: 25, coach: 'ATP Coach', city: 'Dubai' },
  { name: 'Strength & Conditioning', activity: 'Strength Training', day_of_week: 'Thursday', time: '06:00', location: 'Mushrif Park, Dubai', duration_minutes: 60, max_participants: 20, coach: 'ATP Coach', city: 'Dubai' },
  { name: 'Trail Run', activity: 'Running', day_of_week: 'Friday', time: '06:30', location: 'Al Qudra, Dubai', duration_minutes: 90, max_participants: 40, coach: 'ATP Coach', city: 'Dubai' },
  { name: 'Saturday Bootcamp', activity: 'Bootcamp', day_of_week: 'Saturday', time: '07:00', location: 'Kite Beach, Dubai', duration_minutes: 60, max_participants: 50, coach: 'ATP Coach', city: 'Dubai' },
  { name: 'Sunday Recovery', activity: 'Stretching', day_of_week: 'Sunday', time: '08:00', location: 'Zabeel Park, Dubai', duration_minutes: 45, max_participants: 30, coach: 'ATP Coach', city: 'Dubai' },
  { name: 'Al Ain Morning Run', activity: 'Running', day_of_week: 'Tuesday', time: '06:00', location: 'Hili Park, Al Ain', duration_minutes: 60, max_participants: 30, coach: 'ATP Coach', city: 'Al Ain' },
  { name: 'Al Ain HIIT', activity: 'HIIT', day_of_week: 'Thursday', time: '06:30', location: 'Central Park, Al Ain', duration_minutes: 45, max_participants: 25, coach: 'ATP Coach', city: 'Al Ain' },
  { name: 'Al Ain Weekend Session', activity: 'Bootcamp', day_of_week: 'Friday', time: '07:00', location: 'Formal Park, Al Ain', duration_minutes: 60, max_participants: 40, coach: 'ATP Coach', city: 'Al Ain' },
  { name: 'Muscat Morning Run', activity: 'Running', day_of_week: 'Wednesday', time: '06:00', location: 'Qurum Beach, Muscat', duration_minutes: 60, max_participants: 30, coach: 'ATP Coach', city: 'Muscat' },
  { name: 'Muscat Weekend Bootcamp', activity: 'Bootcamp', day_of_week: 'Saturday', time: '07:00', location: 'Al Qurm Park, Muscat', duration_minutes: 60, max_participants: 35, coach: 'ATP Coach', city: 'Muscat' },
];

async function seedSessions() {
  console.log('🌱 Seeding sessions...');
  let created = 0;
  for (const s of sessions) {
    try {
      // Get or create city
      const { rows: cityRows } = await query(
        `INSERT INTO cities (name, country) VALUES ($1, 'UAE') ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
        [s.city]
      );
      const city_id = cityRows[0].id;

      await query(
        `INSERT INTO sessions (name, activity_type, day_of_week, start_time, location_name, duration_minutes, max_participants, city_id, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')
         ON CONFLICT DO NOTHING`,
        [s.name, s.activity, s.day_of_week, s.time, s.location, s.duration_minutes, s.max_participants, city_id]
      );
      created++;
    } catch (e) {
      console.log(`⚠️  ${s.name}: ${e.message}`);
    }
  }
  console.log(`✅ Seeded ${created} sessions`);
  process.exit(0);
}

seedSessions().catch(e => { console.error(e); process.exit(1); });
