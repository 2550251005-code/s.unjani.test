# s.unjani.ac.id v0.2.1 (SSO-Only)

Aplikasi shortlink `s.unjani.ac.id` dengan autentikasi dan data user terpusat di `sso-sisfo.unjani.ac.id v0.2.0`.

## Mode autentikasi

- `Strict SSO Only`
- Login lokal, register lokal, dan reset/change password lokal dinonaktifkan.
- Kelola user dipusatkan di SSO (`/admin/users` pada aplikasi SSO).
- `/restapi/link` hanya menerima `Authorization: Bearer <token SSO>`.

## Menjalankan aplikasi

```bash
npm install
npm run dev
```

## Konfigurasi `.env`

Salin `.env.example` menjadi `.env`, lalu isi minimal:

- `SSO_BASE_URL`
- `SSO_CLIENT_ID`
- `SSO_CLIENT_SECRET`
- `SSO_REDIRECT_URI`
- `SSO_JWT_SECRET`

Konfigurasi tambahan:

- `SSO_ADMIN_USERS_PATH` default `/admin/users`
- `RESTAPI_LEGACY_SECRETKEY_UNTIL` isi tanggal lampau (contoh di `.env.example`) untuk memastikan mode legacy nonaktif di deployment lama.

## Perubahan endpoint penting

- `GET /admin/users` redirect ke halaman user management di SSO.
- Endpoint lokal kelola user dinonaktifkan (`410`):
  - `POST /admin/user`
  - `POST /admin/updateUser`
  - `POST /admin/delUser`
  - `POST /admin/users/:id/reset-password`
- `POST /api/users` dinonaktifkan (`410`), user dikelola di SSO.
- `POST /users/register` dinonaktifkan, redirect ke SSO register.
- `POST /users/changePassword` dan flow `/users/force-reset` lokal dinonaktifkan, diarahkan ke SSO.
- `POST /users/profile/update`, `POST /users/profile/password`, dan `POST /users/profile/photo` mengubah data user melalui API SSO (bukan DB user lokal).

## REST API `/restapi/link`

- Wajib `Authorization: Bearer <token SSO>`.
- Request tanpa Bearer token akan `401 Unauthorized`.
- `secretKey` legacy tidak digunakan lagi.

## Profile user di s.unjani

- Halaman `/users/profile` memakai data user dari SSO (`/api/users/me`).
- Edit profil dasar yang didukung: `name`, `jabatanFungsional`, `dosenProdi`.
- Ubah password dilakukan inline dan diverifikasi ke SSO dengan `currentPassword`.
- Upload foto profil diteruskan ke SSO dan disimpan di sisi SSO.

## Catatan migrasi

- Jika `_id` user di `s.unjani` dan `sso-sisfo` sama 1:1, migrasi ownership tidak diperlukan.
- Koleksi `legacy_user_maps` boleh kosong dan dianggap artefak kompatibilitas lama.
