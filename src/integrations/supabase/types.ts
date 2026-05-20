export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      article_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      articles: {
        Row: {
          author_id: string | null
          body: string | null
          category: string | null
          cover_alt: string | null
          cover_url: string | null
          created_at: string
          excerpt: string | null
          gallery_images: Json
          id: string
          meta_description: string | null
          meta_title: string | null
          published_at: string | null
          reading_time_minutes: number | null
          slug: string
          status: Database["public"]["Enums"]["content_status"]
          tags: string[] | null
          title: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body?: string | null
          category?: string | null
          cover_alt?: string | null
          cover_url?: string | null
          created_at?: string
          excerpt?: string | null
          gallery_images?: Json
          id?: string
          meta_description?: string | null
          meta_title?: string | null
          published_at?: string | null
          reading_time_minutes?: number | null
          slug: string
          status?: Database["public"]["Enums"]["content_status"]
          tags?: string[] | null
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body?: string | null
          category?: string | null
          cover_alt?: string | null
          cover_url?: string | null
          created_at?: string
          excerpt?: string | null
          gallery_images?: Json
          id?: string
          meta_description?: string | null
          meta_title?: string | null
          published_at?: string | null
          reading_time_minutes?: number | null
          slug?: string
          status?: Database["public"]["Enums"]["content_status"]
          tags?: string[] | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      booking_audit_log: {
        Row: {
          booking_id: string
          created_at: string
          field: string
          id: string
          new_value: string | null
          old_value: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          booking_id: string
          created_at?: string
          field: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          booking_id?: string
          created_at?: string
          field?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      booking_documents: {
        Row: {
          booking_id: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          meta: Json | null
          number: string
          paid_mad: number | null
          payment_id: string | null
          storage_path: string
          total_mad: number | null
        }
        Insert: {
          booking_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          meta?: Json | null
          number: string
          paid_mad?: number | null
          payment_id?: string | null
          storage_path: string
          total_mad?: number | null
        }
        Update: {
          booking_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          meta?: Json | null
          number?: string
          paid_mad?: number | null
          payment_id?: string | null
          storage_path?: string
          total_mad?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_documents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_documents_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_extras: {
        Row: {
          booking_id: string
          created_at: string
          extra_id: string | null
          id: string
          name_snapshot: string
          qty: number
          unit_price_mad: number
        }
        Insert: {
          booking_id: string
          created_at?: string
          extra_id?: string | null
          id?: string
          name_snapshot: string
          qty?: number
          unit_price_mad?: number
        }
        Update: {
          booking_id?: string
          created_at?: string
          extra_id?: string | null
          id?: string
          name_snapshot?: string
          qty?: number
          unit_price_mad?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_extras_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_extras_extra_id_fkey"
            columns: ["extra_id"]
            isOneToOne: false
            referencedRelation: "extras"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_participant_activities: {
        Row: {
          created_at: string
          extra_id: string
          id: string
          is_selected: boolean
          participant_id: string
        }
        Insert: {
          created_at?: string
          extra_id: string
          id?: string
          is_selected?: boolean
          participant_id: string
        }
        Update: {
          created_at?: string
          extra_id?: string
          id?: string
          is_selected?: boolean
          participant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_participant_activities_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "booking_participants"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_participants: {
        Row: {
          booking_id: string
          client_id: string | null
          client_type: string | null
          created_at: string
          date_of_birth: string | null
          email: string | null
          first_name: string
          id: string
          is_lead: boolean
          last_name: string
          nationality: string | null
          notes: string | null
          passport_expiry: string | null
          passport_issue_date: string | null
          passport_no: string | null
          phone: string | null
          relation: string | null
          sex: string | null
          trip_id: string | null
          updated_at: string
        }
        Insert: {
          booking_id: string
          client_id?: string | null
          client_type?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          first_name?: string
          id?: string
          is_lead?: boolean
          last_name?: string
          nationality?: string | null
          notes?: string | null
          passport_expiry?: string | null
          passport_issue_date?: string | null
          passport_no?: string | null
          phone?: string | null
          relation?: string | null
          sex?: string | null
          trip_id?: string | null
          updated_at?: string
        }
        Update: {
          booking_id?: string
          client_id?: string | null
          client_type?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          first_name?: string
          id?: string
          is_lead?: boolean
          last_name?: string
          nationality?: string | null
          notes?: string | null
          passport_expiry?: string | null
          passport_issue_date?: string | null
          passport_no?: string | null
          phone?: string | null
          relation?: string | null
          sex?: string | null
          trip_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      bookings: {
        Row: {
          assigned_to: string | null
          client_id: string | null
          contact_city: string | null
          contact_email: string
          contact_name: string
          contact_phone: string | null
          created_at: string
          formula: string | null
          id: string
          message: string | null
          num_adults: number
          num_children: number
          paid_amount_mad: number
          preferred_dates: string | null
          reference: string
          room_type: string | null
          source: string | null
          status: Database["public"]["Enums"]["booking_status"]
          total_amount_mad: number
          trip_id: string | null
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          client_id?: string | null
          contact_city?: string | null
          contact_email: string
          contact_name: string
          contact_phone?: string | null
          created_at?: string
          formula?: string | null
          id?: string
          message?: string | null
          num_adults?: number
          num_children?: number
          paid_amount_mad?: number
          preferred_dates?: string | null
          reference?: string
          room_type?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          total_amount_mad?: number
          trip_id?: string | null
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          client_id?: string | null
          contact_city?: string | null
          contact_email?: string
          contact_name?: string
          contact_phone?: string | null
          created_at?: string
          formula?: string | null
          id?: string
          message?: string | null
          num_adults?: number
          num_children?: number
          paid_amount_mad?: number
          preferred_dates?: string | null
          reference?: string
          room_type?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          total_amount_mad?: number
          trip_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      client_notes: {
        Row: {
          author_id: string | null
          body: string
          client_id: string
          created_at: string
          id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          client_id: string
          created_at?: string
          id?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          client_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_rewards: {
        Row: {
          client_id: string
          created_at: string
          expires_at: string | null
          granted_reason: string | null
          id: string
          label: string
          percent: number | null
          status: Database["public"]["Enums"]["reward_status"]
          type: Database["public"]["Enums"]["reward_type"]
          updated_at: string
          used_at: string | null
          used_booking_id: string | null
          value_mad: number
        }
        Insert: {
          client_id: string
          created_at?: string
          expires_at?: string | null
          granted_reason?: string | null
          id?: string
          label: string
          percent?: number | null
          status?: Database["public"]["Enums"]["reward_status"]
          type: Database["public"]["Enums"]["reward_type"]
          updated_at?: string
          used_at?: string | null
          used_booking_id?: string | null
          value_mad?: number
        }
        Update: {
          client_id?: string
          created_at?: string
          expires_at?: string | null
          granted_reason?: string | null
          id?: string
          label?: string
          percent?: number | null
          status?: Database["public"]["Enums"]["reward_status"]
          type?: Database["public"]["Enums"]["reward_type"]
          updated_at?: string
          used_at?: string | null
          used_booking_id?: string | null
          value_mad?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_rewards_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          birthdate: string | null
          birth_date: string | null
          city: string | null
          country: string | null
          created_at: string
          date_of_birth: string | null
          email: string | null
          email_subscribed: boolean
          emergency_contact: string | null
          first_trip_at: string | null
          full_name: string
          id: string
          is_returning: boolean
          language: string
          last_trip_at: string | null
          last_trip_id: string | null
          last_trip_label: string | null
          loyalty_tier: string
          marketing_bounce_reason: string | null
          marketing_status: string
          marketing_unsubscribed_at: string | null
          metadata: Json
          nationality: string | null
          notes: string | null
          address: string | null
          passport_expiry: string | null
          passport_file_path: string | null
          passport_issue_date: string | null
          passport_no: string | null
          passport_number: string | null
          phone: string | null
          rewards_used: number
          sex: string | null
          source: string | null
          tags: string[] | null
          trips_completed: number
          unsubscribe_token: string
          updated_at: string
        }
        Insert: {
          birthdate?: string | null
          birth_date?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          email_subscribed?: boolean
          emergency_contact?: string | null
          first_trip_at?: string | null
          full_name: string
          id?: string
          is_returning?: boolean
          language?: string
          last_trip_at?: string | null
          last_trip_id?: string | null
          last_trip_label?: string | null
          loyalty_tier?: string
          marketing_bounce_reason?: string | null
          marketing_status?: string
          marketing_unsubscribed_at?: string | null
          metadata?: Json
          nationality?: string | null
          notes?: string | null
          address?: string | null
          passport_expiry?: string | null
          passport_file_path?: string | null
          passport_issue_date?: string | null
          passport_no?: string | null
          passport_number?: string | null
          phone?: string | null
          rewards_used?: number
          sex?: string | null
          source?: string | null
          tags?: string[] | null
          trips_completed?: number
          unsubscribe_token?: string
          updated_at?: string
        }
        Update: {
          birthdate?: string | null
          birth_date?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          email_subscribed?: boolean
          emergency_contact?: string | null
          first_trip_at?: string | null
          full_name?: string
          id?: string
          is_returning?: boolean
          language?: string
          last_trip_at?: string | null
          last_trip_id?: string | null
          last_trip_label?: string | null
          loyalty_tier?: string
          marketing_bounce_reason?: string | null
          marketing_status?: string
          marketing_unsubscribed_at?: string | null
          metadata?: Json
          nationality?: string | null
          notes?: string | null
          address?: string | null
          passport_expiry?: string | null
          passport_file_path?: string | null
          passport_issue_date?: string | null
          passport_no?: string | null
          passport_number?: string | null
          phone?: string | null
          rewards_used?: number
          sex?: string | null
          source?: string | null
          tags?: string[] | null
          trips_completed?: number
          unsubscribe_token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_last_trip_id_fkey"
            columns: ["last_trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      content_translations: {
        Row: {
          created_at: string
          field: string
          id: string
          language: string
          row_id: string
          source_text_hash: string | null
          status: string
          table_name: string
          updated_at: string
          updated_by: string | null
          value_text: string | null
        }
        Insert: {
          created_at?: string
          field: string
          id?: string
          language: string
          row_id: string
          source_text_hash?: string | null
          status?: string
          table_name: string
          updated_at?: string
          updated_by?: string | null
          value_text?: string | null
        }
        Update: {
          created_at?: string
          field?: string
          id?: string
          language?: string
          row_id?: string
          source_text_hash?: string | null
          status?: string
          table_name?: string
          updated_at?: string
          updated_by?: string | null
          value_text?: string | null
        }
        Relationships: []
      }
      email_campaign_recipients: {
        Row: {
          campaign_id: string
          click_count: number
          client_id: string | null
          created_at: string
          email: string
          error_message: string | null
          first_clicked_at: string | null
          first_opened_at: string | null
          full_name: string | null
          id: string
          open_count: number
          sent_at: string | null
          status: Database["public"]["Enums"]["recipient_status"]
          tracking_token: string
        }
        Insert: {
          campaign_id: string
          click_count?: number
          client_id?: string | null
          created_at?: string
          email: string
          error_message?: string | null
          first_clicked_at?: string | null
          first_opened_at?: string | null
          full_name?: string | null
          id?: string
          open_count?: number
          sent_at?: string | null
          status?: Database["public"]["Enums"]["recipient_status"]
          tracking_token?: string
        }
        Update: {
          campaign_id?: string
          click_count?: number
          client_id?: string | null
          created_at?: string
          email?: string
          error_message?: string | null
          first_clicked_at?: string | null
          first_opened_at?: string | null
          full_name?: string | null
          id?: string
          open_count?: number
          sent_at?: string | null
          status?: Database["public"]["Enums"]["recipient_status"]
          tracking_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaign_recipients_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaigns: {
        Row: {
          bounced_count: number
          click_count: number
          company_address: string | null
          company_name: string | null
          created_at: string
          created_by: string | null
          cta_label: string | null
          cta_url: string | null
          failed_count: number
          from_email: string | null
          from_name: string | null
          hero_image_url: string | null
          html_body: string
          id: string
          language: string
          name: string
          open_count: number
          preheader: string | null
          reply_to: string | null
          scheduled_at: string | null
          segment_id: string | null
          segment_tag: string | null
          segment_type: Database["public"]["Enums"]["segment_type"]
          sent_at: string | null
          sent_count: number
          status: Database["public"]["Enums"]["campaign_status"]
          subject: string
          template_id: string | null
          total_recipients: number
          unique_click_count: number
          unique_open_count: number
          unsubscribed_count: number
          updated_at: string
        }
        Insert: {
          bounced_count?: number
          click_count?: number
          company_address?: string | null
          company_name?: string | null
          created_at?: string
          created_by?: string | null
          cta_label?: string | null
          cta_url?: string | null
          failed_count?: number
          from_email?: string | null
          from_name?: string | null
          hero_image_url?: string | null
          html_body?: string
          id?: string
          language?: string
          name: string
          open_count?: number
          preheader?: string | null
          reply_to?: string | null
          scheduled_at?: string | null
          segment_id?: string | null
          segment_tag?: string | null
          segment_type?: Database["public"]["Enums"]["segment_type"]
          sent_at?: string | null
          sent_count?: number
          status?: Database["public"]["Enums"]["campaign_status"]
          subject: string
          template_id?: string | null
          total_recipients?: number
          unique_click_count?: number
          unique_open_count?: number
          unsubscribed_count?: number
          updated_at?: string
        }
        Update: {
          bounced_count?: number
          click_count?: number
          company_address?: string | null
          company_name?: string | null
          created_at?: string
          created_by?: string | null
          cta_label?: string | null
          cta_url?: string | null
          failed_count?: number
          from_email?: string | null
          from_name?: string | null
          hero_image_url?: string | null
          html_body?: string
          id?: string
          language?: string
          name?: string
          open_count?: number
          preheader?: string | null
          reply_to?: string | null
          scheduled_at?: string | null
          segment_id?: string | null
          segment_tag?: string | null
          segment_type?: Database["public"]["Enums"]["segment_type"]
          sent_at?: string | null
          sent_count?: number
          status?: Database["public"]["Enums"]["campaign_status"]
          subject?: string
          template_id?: string | null
          total_recipients?: number
          unique_click_count?: number
          unique_open_count?: number
          unsubscribed_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_campaigns_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "marketing_segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaigns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      email_events: {
        Row: {
          campaign_id: string
          created_at: string
          event_type: Database["public"]["Enums"]["email_event_type"]
          id: string
          ip_hash: string | null
          recipient_id: string | null
          url: string | null
          user_agent: string | null
        }
        Insert: {
          campaign_id: string
          created_at?: string
          event_type: Database["public"]["Enums"]["email_event_type"]
          id?: string
          ip_hash?: string | null
          recipient_id?: string | null
          url?: string | null
          user_agent?: string | null
        }
        Update: {
          campaign_id?: string
          created_at?: string
          event_type?: Database["public"]["Enums"]["email_event_type"]
          id?: string
          ip_hash?: string | null
          recipient_id?: string | null
          url?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_events_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "email_campaign_recipients"
            referencedColumns: ["id"]
          },
        ]
      }
      email_settings: {
        Row: {
          company_address: string
          company_name: string
          created_at: string
          from_email: string
          from_name: string
          id: string
          is_active: boolean
          provider: string
          reply_to: string | null
          smtp_host: string
          smtp_password: string
          smtp_port: number
          smtp_secure: string
          smtp_username: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_address?: string
          company_name?: string
          created_at?: string
          from_email?: string
          from_name?: string
          id?: string
          is_active?: boolean
          provider?: string
          reply_to?: string | null
          smtp_host?: string
          smtp_password?: string
          smtp_port?: number
          smtp_secure?: string
          smtp_username?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_address?: string
          company_name?: string
          created_at?: string
          from_email?: string
          from_name?: string
          id?: string
          is_active?: boolean
          provider?: string
          reply_to?: string | null
          smtp_host?: string
          smtp_password?: string
          smtp_port?: number
          smtp_secure?: string
          smtp_username?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      email_templates: {
        Row: {
          category: string | null
          created_at: string
          created_by: string | null
          cta_label: string | null
          cta_url: string | null
          hero_image_url: string | null
          html_body: string
          id: string
          is_system: boolean
          language: string
          name: string
          preheader: string | null
          subject: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          cta_label?: string | null
          cta_url?: string | null
          hero_image_url?: string | null
          html_body?: string
          id?: string
          is_system?: boolean
          language?: string
          name: string
          preheader?: string | null
          subject: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          cta_label?: string | null
          cta_url?: string | null
          hero_image_url?: string | null
          html_body?: string
          id?: string
          is_system?: boolean
          language?: string
          name?: string
          preheader?: string | null
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      extras: {
        Row: {
          alt_text: string | null
          category: string | null
          city: string | null
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          price_mad: number
          slug: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          alt_text?: string | null
          category?: string | null
          city?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          price_mad?: number
          slug?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          alt_text?: string | null
          category?: string | null
          city?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          price_mad?: number
          slug?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      faqs: {
        Row: {
          answer_ar: string | null
          answer_en: string | null
          answer_fr: string
          category: Database["public"]["Enums"]["faq_category"]
          created_at: string
          id: string
          is_published: boolean
          meta_description_ar: string | null
          meta_description_en: string | null
          meta_description_fr: string | null
          meta_title_ar: string | null
          meta_title_en: string | null
          meta_title_fr: string | null
          question_ar: string | null
          question_en: string | null
          question_fr: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          answer_ar?: string | null
          answer_en?: string | null
          answer_fr: string
          category?: Database["public"]["Enums"]["faq_category"]
          created_at?: string
          id?: string
          is_published?: boolean
          meta_description_ar?: string | null
          meta_description_en?: string | null
          meta_description_fr?: string | null
          meta_title_ar?: string | null
          meta_title_en?: string | null
          meta_title_fr?: string | null
          question_ar?: string | null
          question_en?: string | null
          question_fr: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          answer_ar?: string | null
          answer_en?: string | null
          answer_fr?: string
          category?: Database["public"]["Enums"]["faq_category"]
          created_at?: string
          id?: string
          is_published?: boolean
          meta_description_ar?: string | null
          meta_description_en?: string | null
          meta_description_fr?: string | null
          meta_title_ar?: string | null
          meta_title_en?: string | null
          meta_title_fr?: string | null
          question_ar?: string | null
          question_en?: string | null
          question_fr?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      itinerary_days: {
        Row: {
          accommodation: string | null
          city: string | null
          created_at: string
          day_number: number
          description: string | null
          id: string
          meals: string | null
          title: string
          trip_id: string
        }
        Insert: {
          accommodation?: string | null
          city?: string | null
          created_at?: string
          day_number: number
          description?: string | null
          id?: string
          meals?: string | null
          title: string
          trip_id: string
        }
        Update: {
          accommodation?: string | null
          city?: string | null
          created_at?: string
          day_number?: number
          description?: string | null
          id?: string
          meals?: string | null
          title?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "itinerary_days_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_segments: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          filters: Json
          id: string
          is_system: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          filters?: Json
          id?: string
          is_system?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          filters?: Json
          id?: string
          is_system?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      media: {
        Row: {
          alt: string | null
          created_at: string
          height: number | null
          id: string
          mime_type: string | null
          size_bytes: number | null
          storage_path: string
          tags: string[] | null
          uploaded_by: string | null
          url: string
          width: number | null
        }
        Insert: {
          alt?: string | null
          created_at?: string
          height?: number | null
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path: string
          tags?: string[] | null
          uploaded_by?: string | null
          url: string
          width?: number | null
        }
        Update: {
          alt?: string | null
          created_at?: string
          height?: number | null
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string
          tags?: string[] | null
          uploaded_by?: string | null
          url?: string
          width?: number | null
        }
        Relationships: []
      }
      newsletter_subscribers: {
        Row: {
          created_at: string
          email: string
          id: string
          is_active: boolean
          source: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          is_active?: boolean
          source?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean
          source?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      pages: {
        Row: {
          content: Json
          created_at: string
          id: string
          meta_description: string | null
          slug: string
          status: Database["public"]["Enums"]["content_status"]
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          content?: Json
          created_at?: string
          id?: string
          meta_description?: string | null
          slug: string
          status?: Database["public"]["Enums"]["content_status"]
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          content?: Json
          created_at?: string
          id?: string
          meta_description?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["content_status"]
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount_mad: number
          booking_id: string
          created_at: string
          id: string
          method: string | null
          notes: string | null
          paid_at: string | null
          recorded_by: string | null
          reference: string | null
          status: Database["public"]["Enums"]["payment_status"]
        }
        Insert: {
          amount_mad: number
          booking_id: string
          created_at?: string
          id?: string
          method?: string | null
          notes?: string | null
          paid_at?: string | null
          recorded_by?: string | null
          reference?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
        }
        Update: {
          amount_mad?: number
          booking_id?: string
          created_at?: string
          id?: string
          method?: string | null
          notes?: string | null
          paid_at?: string | null
          recorded_by?: string | null
          reference?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
        }
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_tiers: {
        Row: {
          base_supplement_mad: number
          created_at: string
          description: string | null
          id: string
          name: string
          single_room_supplement_mad: number
          sort_order: number
          trip_id: string
          triple_room_discount_mad: number
        }
        Insert: {
          base_supplement_mad?: number
          created_at?: string
          description?: string | null
          id?: string
          name: string
          single_room_supplement_mad?: number
          sort_order?: number
          trip_id: string
          triple_room_discount_mad?: number
        }
        Update: {
          base_supplement_mad?: number
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          single_room_supplement_mad?: number
          sort_order?: number
          trip_id?: string
          triple_room_discount_mad?: number
        }
        Relationships: [
          {
            foreignKeyName: "pricing_tiers_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      programme_days: {
        Row: {
          badge: string | null
          city: string
          created_at: string
          day_number: number
          description: string
          gallery_images: Json
          icons: Json
          id: string
          included_items: Json
          is_active: boolean
          is_optional: boolean
          main_image_url: string | null
          programme_id: string
          schedule_items: Json
          sort_order: number
          special_note: string | null
          title: string
          updated_at: string
        }
        Insert: {
          badge?: string | null
          city?: string
          created_at?: string
          day_number: number
          description?: string
          gallery_images?: Json
          icons?: Json
          id?: string
          included_items?: Json
          is_active?: boolean
          is_optional?: boolean
          main_image_url?: string | null
          programme_id: string
          schedule_items?: Json
          sort_order?: number
          special_note?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          badge?: string | null
          city?: string
          created_at?: string
          day_number?: number
          description?: string
          gallery_images?: Json
          icons?: Json
          id?: string
          included_items?: Json
          is_active?: boolean
          is_optional?: boolean
          main_image_url?: string | null
          programme_id?: string
          schedule_items?: Json
          sort_order?: number
          special_note?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "programme_days_programme_id_fkey"
            columns: ["programme_id"]
            isOneToOne: false
            referencedRelation: "programmes"
            referencedColumns: ["id"]
          },
        ]
      }
      programmes: {
        Row: {
          cities: string[]
          created_at: string
          cta_label: string
          cta_url: string
          days: Json
          description: string
          duration: string
          hero_alt: string | null
          hero_image_url: string | null
          id: string
          introduction: string
          is_published: boolean
          meta_description: string | null
          pdf_path: string | null
          pdf_url: string | null
          slug: string
          sort_order: number
          subtitle: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cities?: string[]
          created_at?: string
          cta_label?: string
          cta_url?: string
          days?: Json
          description?: string
          duration?: string
          hero_alt?: string | null
          hero_image_url?: string | null
          id?: string
          introduction?: string
          is_published?: boolean
          meta_description?: string | null
          pdf_path?: string | null
          pdf_url?: string | null
          slug: string
          sort_order?: number
          subtitle?: string
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cities?: string[]
          created_at?: string
          cta_label?: string
          cta_url?: string
          days?: Json
          description?: string
          duration?: string
          hero_alt?: string | null
          hero_image_url?: string | null
          id?: string
          introduction?: string
          is_published?: boolean
          meta_description?: string | null
          pdf_path?: string | null
          pdf_url?: string | null
          slug?: string
          sort_order?: number
          subtitle?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      room_assignments: {
        Row: {
          created_at: string
          id: string
          participant_id: string
          room_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          participant_id: string
          room_id: string
        }
        Update: {
          created_at?: string
          id?: string
          participant_id?: string
          room_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_assignments_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: true
            referencedRelation: "booking_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_assignments_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "trip_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      route_slugs: {
        Row: {
          created_at: string
          default_slug: string
          id: string
          is_editable: boolean
          label: string
          route_key: string
          slug: string
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          default_slug: string
          id?: string
          is_editable?: boolean
          label: string
          route_key: string
          slug: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          default_slug?: string
          id?: string
          is_editable?: boolean
          label?: string
          route_key?: string
          slug?: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      supplier_day_costs: {
        Row: {
          activities_cost: number
          city: string | null
          created_at: string
          created_by: string | null
          currency: string
          day_number: number
          guide_cost: number
          hotel_cost: number
          id: string
          meals_cost: number
          nights: number
          notes: string | null
          services: string | null
          supplier_id: string
          total_cost: number | null
          transport_cost: number
          trip_id: string
          updated_at: string
        }
        Insert: {
          activities_cost?: number
          city?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          day_number: number
          guide_cost?: number
          hotel_cost?: number
          id?: string
          meals_cost?: number
          nights?: number
          notes?: string | null
          services?: string | null
          supplier_id: string
          total_cost?: number | null
          transport_cost?: number
          trip_id: string
          updated_at?: string
        }
        Update: {
          activities_cost?: number
          city?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          day_number?: number
          guide_cost?: number
          hotel_cost?: number
          id?: string
          meals_cost?: number
          nights?: number
          notes?: string | null
          services?: string | null
          supplier_id?: string
          total_cost?: number | null
          transport_cost?: number
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_day_costs_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_day_costs_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_members: {
        Row: {
          created_at: string
          id: string
          supplier_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          supplier_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          supplier_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_members_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          category: string | null
          city: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      trip_hotels: {
        Row: {
          city: string | null
          created_at: string
          id: string
          name: string
          sort_order: number
          trip_id: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          trip_id: string
        }
        Update: {
          city?: string | null
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          trip_id?: string
        }
        Relationships: []
      }
      trip_japan_payments: {
        Row: {
          amount: number
          amount_mad: number
          beneficiary: string | null
          comment: string | null
          created_at: string
          created_by: string | null
          currency: string
          exchange_rate: number
          id: string
          method: string | null
          paid_on: string
          receipt_url: string | null
          trip_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          amount_mad?: number
          beneficiary?: string | null
          comment?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          exchange_rate?: number
          id?: string
          method?: string | null
          paid_on?: string
          receipt_url?: string | null
          trip_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          amount_mad?: number
          beneficiary?: string | null
          comment?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          exchange_rate?: number
          id?: string
          method?: string | null
          paid_on?: string
          receipt_url?: string | null
          trip_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      trip_rooms: {
        Row: {
          capacity: number
          client_type: string | null
          created_at: string
          id: string
          notes: string | null
          room_number: string | null
          room_type: string
          trip_hotel_id: string
        }
        Insert: {
          capacity?: number
          client_type?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          room_number?: string | null
          room_type?: string
          trip_hotel_id: string
        }
        Update: {
          capacity?: number
          client_type?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          room_number?: string | null
          room_type?: string
          trip_hotel_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_rooms_trip_hotel_id_fkey"
            columns: ["trip_hotel_id"]
            isOneToOne: false
            referencedRelation: "trip_hotels"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_suppliers: {
        Row: {
          role: string | null
          supplier_id: string
          trip_id: string
        }
        Insert: {
          role?: string | null
          supplier_id: string
          trip_id: string
        }
        Update: {
          role?: string | null
          supplier_id?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_suppliers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_suppliers_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          badge_text: string | null
          badge_type: string | null
          base_price_mad: number
          cover_alt: string | null
          cover_url: string | null
          created_at: string
          created_by: string | null
          currency: string
          destination: string | null
          destinations: string[] | null
          duration_days: number | null
          end_date: string | null
          highlights: string[] | null
          id: string
          is_featured: boolean
          label: string | null
          long_description: string | null
          program_link: string | null
          promo_percent: number | null
          season: string | null
          short_description: string | null
          slots_left: number
          slug: string
          sort_order: number
          start_date: string | null
          status: Database["public"]["Enums"]["trip_status"]
          title: string
          total_slots: number
          updated_at: string
        }
        Insert: {
          badge_text?: string | null
          badge_type?: string | null
          base_price_mad?: number
          cover_alt?: string | null
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          destination?: string | null
          destinations?: string[] | null
          duration_days?: number | null
          end_date?: string | null
          highlights?: string[] | null
          id?: string
          is_featured?: boolean
          label?: string | null
          long_description?: string | null
          program_link?: string | null
          promo_percent?: number | null
          season?: string | null
          short_description?: string | null
          slots_left?: number
          slug: string
          sort_order?: number
          start_date?: string | null
          status?: Database["public"]["Enums"]["trip_status"]
          title: string
          total_slots?: number
          updated_at?: string
        }
        Update: {
          badge_text?: string | null
          badge_type?: string | null
          base_price_mad?: number
          cover_alt?: string | null
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          destination?: string | null
          destinations?: string[] | null
          duration_days?: number | null
          end_date?: string | null
          highlights?: string[] | null
          id?: string
          is_featured?: boolean
          label?: string | null
          long_description?: string | null
          program_link?: string | null
          promo_percent?: number | null
          season?: string | null
          short_description?: string | null
          slots_left?: number
          slug?: string
          sort_order?: number
          start_date?: string | null
          status?: Database["public"]["Enums"]["trip_status"]
          title?: string
          total_slots?: number
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      visa_applications: {
        Row: {
          admin_notes: string | null
          airline_or_ship: string | null
          booking_id: string | null
          category: string | null
          certificate_of_eligibility_no: string | null
          consent_data: boolean
          consent_disclaimer: boolean
          consent_truthful: boolean
          created_at: string
          date_of_application: string | null
          date_of_arrival: string | null
          date_of_birth: string | null
          declarations_details: string | null
          documents_requested_at: string | null
          employer_address: string | null
          employer_name: string | null
          employer_tel: string | null
          former_nationality: string | null
          given_names: string | null
          hotel_address: string | null
          hotel_name: string | null
          hotel_tel: string | null
          id: string
          intended_length_of_stay: string | null
          marital_status: string | null
          national_id_no: string | null
          nationality: string | null
          other_names: string | null
          partner_profession: string | null
          passport_date_of_expiry: string | null
          passport_date_of_issue: string | null
          passport_issuing_authority: string | null
          passport_no: string | null
          passport_place_of_issue: string | null
          passport_type: string | null
          place_of_birth_city: string | null
          place_of_birth_country: string | null
          place_of_birth_state: string | null
          port_of_entry: string | null
          previous_stays: string | null
          profession: string | null
          purpose_of_visit: string | null
          q_convicted_crime: boolean
          q_deported: boolean
          q_drug_offence: boolean
          q_imprisoned_1y: boolean
          q_prostitution: boolean
          q_trafficking: boolean
          reference: string
          remarks: string | null
          requested_documents: string | null
          residential_address: string | null
          residential_email: string | null
          residential_mobile: string | null
          residential_tel: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sex: string | null
          status: Database["public"]["Enums"]["visa_status"]
          submitted_at: string | null
          surname: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          airline_or_ship?: string | null
          booking_id?: string | null
          category?: string | null
          certificate_of_eligibility_no?: string | null
          consent_data?: boolean
          consent_disclaimer?: boolean
          consent_truthful?: boolean
          created_at?: string
          date_of_application?: string | null
          date_of_arrival?: string | null
          date_of_birth?: string | null
          declarations_details?: string | null
          documents_requested_at?: string | null
          employer_address?: string | null
          employer_name?: string | null
          employer_tel?: string | null
          former_nationality?: string | null
          given_names?: string | null
          hotel_address?: string | null
          hotel_name?: string | null
          hotel_tel?: string | null
          id?: string
          intended_length_of_stay?: string | null
          marital_status?: string | null
          national_id_no?: string | null
          nationality?: string | null
          other_names?: string | null
          partner_profession?: string | null
          passport_date_of_expiry?: string | null
          passport_date_of_issue?: string | null
          passport_issuing_authority?: string | null
          passport_no?: string | null
          passport_place_of_issue?: string | null
          passport_type?: string | null
          place_of_birth_city?: string | null
          place_of_birth_country?: string | null
          place_of_birth_state?: string | null
          port_of_entry?: string | null
          previous_stays?: string | null
          profession?: string | null
          purpose_of_visit?: string | null
          q_convicted_crime?: boolean
          q_deported?: boolean
          q_drug_offence?: boolean
          q_imprisoned_1y?: boolean
          q_prostitution?: boolean
          q_trafficking?: boolean
          reference?: string
          remarks?: string | null
          requested_documents?: string | null
          residential_address?: string | null
          residential_email?: string | null
          residential_mobile?: string | null
          residential_tel?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sex?: string | null
          status?: Database["public"]["Enums"]["visa_status"]
          submitted_at?: string | null
          surname?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          airline_or_ship?: string | null
          booking_id?: string | null
          category?: string | null
          certificate_of_eligibility_no?: string | null
          consent_data?: boolean
          consent_disclaimer?: boolean
          consent_truthful?: boolean
          created_at?: string
          date_of_application?: string | null
          date_of_arrival?: string | null
          date_of_birth?: string | null
          declarations_details?: string | null
          documents_requested_at?: string | null
          employer_address?: string | null
          employer_name?: string | null
          employer_tel?: string | null
          former_nationality?: string | null
          given_names?: string | null
          hotel_address?: string | null
          hotel_name?: string | null
          hotel_tel?: string | null
          id?: string
          intended_length_of_stay?: string | null
          marital_status?: string | null
          national_id_no?: string | null
          nationality?: string | null
          other_names?: string | null
          partner_profession?: string | null
          passport_date_of_expiry?: string | null
          passport_date_of_issue?: string | null
          passport_issuing_authority?: string | null
          passport_no?: string | null
          passport_place_of_issue?: string | null
          passport_type?: string | null
          place_of_birth_city?: string | null
          place_of_birth_country?: string | null
          place_of_birth_state?: string | null
          port_of_entry?: string | null
          previous_stays?: string | null
          profession?: string | null
          purpose_of_visit?: string | null
          q_convicted_crime?: boolean
          q_deported?: boolean
          q_drug_offence?: boolean
          q_imprisoned_1y?: boolean
          q_prostitution?: boolean
          q_trafficking?: boolean
          reference?: string
          remarks?: string | null
          requested_documents?: string | null
          residential_address?: string | null
          residential_email?: string | null
          residential_mobile?: string | null
          residential_tel?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sex?: string | null
          status?: Database["public"]["Enums"]["visa_status"]
          submitted_at?: string | null
          surname?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      visa_document_checklists: {
        Row: {
          category: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          items: Json
          label: string
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          items?: Json
          label: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          items?: Json
          label?: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      visa_documents: {
        Row: {
          application_id: string
          created_at: string
          doc_type: Database["public"]["Enums"]["visa_document_type"]
          file_name: string
          id: string
          mime_type: string | null
          size_bytes: number | null
          storage_path: string
          user_id: string
        }
        Insert: {
          application_id: string
          created_at?: string
          doc_type?: Database["public"]["Enums"]["visa_document_type"]
          file_name: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path: string
          user_id: string
        }
        Update: {
          application_id?: string
          created_at?: string
          doc_type?: Database["public"]["Enums"]["visa_document_type"]
          file_name?: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visa_documents_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "visa_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      visa_settings: {
        Row: {
          created_at: string
          guarantor_address: string
          guarantor_dob: string | null
          guarantor_name: string
          guarantor_nationality: string | null
          guarantor_profession: string | null
          guarantor_relationship: string | null
          guarantor_sex: string | null
          guarantor_tel: string
          id: string
          inviter_address: string | null
          inviter_dob: string | null
          inviter_name: string | null
          inviter_nationality: string | null
          inviter_profession: string | null
          inviter_relationship: string | null
          inviter_same_as_guarantor: boolean
          inviter_sex: string | null
          inviter_tel: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          guarantor_address?: string
          guarantor_dob?: string | null
          guarantor_name?: string
          guarantor_nationality?: string | null
          guarantor_profession?: string | null
          guarantor_relationship?: string | null
          guarantor_sex?: string | null
          guarantor_tel?: string
          id?: string
          inviter_address?: string | null
          inviter_dob?: string | null
          inviter_name?: string | null
          inviter_nationality?: string | null
          inviter_profession?: string | null
          inviter_relationship?: string | null
          inviter_same_as_guarantor?: boolean
          inviter_sex?: string | null
          inviter_tel?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          guarantor_address?: string
          guarantor_dob?: string | null
          guarantor_name?: string
          guarantor_nationality?: string | null
          guarantor_profession?: string | null
          guarantor_relationship?: string | null
          guarantor_sex?: string | null
          guarantor_tel?: string
          id?: string
          inviter_address?: string | null
          inviter_dob?: string | null
          inviter_name?: string | null
          inviter_nationality?: string | null
          inviter_profession?: string | null
          inviter_relationship?: string | null
          inviter_same_as_guarantor?: boolean
          inviter_sex?: string | null
          inviter_tel?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      marketing_contacts_view: {
        Row: {
          city: string | null
          client_id: string | null
          country: string | null
          created_at: string | null
          email: string | null
          full_name: string | null
          is_returning: boolean | null
          language: string | null
          last_trip_at: string | null
          last_trip_label: string | null
          loyalty_tier: string | null
          marketing_status: string | null
          phone: string | null
          source: string | null
          tags: string[] | null
          trips_completed: number | null
          unsubscribe_token: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      claim_marketing_batch: {
        Args: { _campaign_id: string; _limit: number }
        Returns: {
          client_id: string
          email: string
          full_name: string
          id: string
          tracking_token: string
          unsubscribe_token: string
        }[]
      }
      find_or_create_client_for_participant: {
        Args: {
          _email: string
          _full_name: string
          _passport_no: string
          _phone: string
        }
        Returns: {
          client_id: string
          was_existing: boolean
        }[]
      }
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      recalculate_client_loyalty: {
        Args: { _client_id: string }
        Returns: undefined
      }
      recompute_campaign_stats: {
        Args: { _campaign_id: string }
        Returns: undefined
      }
      resolve_marketing_segment: {
        Args: { _segment_id: string }
        Returns: {
          client_id: string
          email: string
          full_name: string
          language: string
          unsubscribe_token: string
        }[]
      }
      resubscribe_marketing_by_token: {
        Args: { _token: string }
        Returns: Json
      }
      supplier_can_access_trip: {
        Args: { _trip_id: string; _user_id: string }
        Returns: boolean
      }
      unsubscribe_marketing_by_token: {
        Args: { _token: string }
        Returns: Json
      }
      upsert_client_from_booking: {
        Args: { _city: string; _email: string; _name: string; _phone: string }
        Returns: string
      }
      user_supplier_ids: { Args: { _user_id: string }; Returns: string[] }
    }
    Enums: {
      app_role:
        | "admin"
        | "manager"
        | "agent"
        | "supplier"
        | "super_admin"
        | "content_manager"
        | "marketing_manager"
      booking_status: "lead" | "confirmed" | "paid" | "cancelled" | "completed"
      campaign_status: "draft" | "scheduled" | "sending" | "sent" | "failed"
      content_status: "draft" | "published"
      email_event_type: "open" | "click"
      faq_category:
        | "voyage"
        | "prix_reservation"
        | "visa"
        | "organisation"
        | "conseils_pratiques"
      payment_status: "pending" | "received" | "refunded"
      recipient_status:
        | "pending"
        | "sending"
        | "sent"
        | "failed"
        | "bounced"
        | "opened"
        | "clicked"
      reward_status: "available" | "used" | "expired"
      reward_type: "discount" | "free_activity" | "vip_upgrade"
      segment_type:
        | "past_travelers"
        | "leads"
        | "tag"
        | "all_subscribed"
        | "custom"
      trip_status: "draft" | "open" | "closed" | "completed"
      visa_document_type:
        | "passport"
        | "photo"
        | "employment"
        | "flight"
        | "hotel"
        | "other"
      visa_status:
        | "draft"
        | "submitted"
        | "documents_received"
        | "in_review"
        | "approved"
        | "rejected"
        | "completed"
        | "awaiting_documents"
        | "submitted_to_embassy"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "manager",
        "agent",
        "supplier",
        "super_admin",
        "content_manager",
        "marketing_manager",
      ],
      booking_status: ["lead", "confirmed", "paid", "cancelled", "completed"],
      campaign_status: ["draft", "scheduled", "sending", "sent", "failed"],
      content_status: ["draft", "published"],
      email_event_type: ["open", "click"],
      faq_category: [
        "voyage",
        "prix_reservation",
        "visa",
        "organisation",
        "conseils_pratiques",
      ],
      payment_status: ["pending", "received", "refunded"],
      recipient_status: [
        "pending",
        "sending",
        "sent",
        "failed",
        "bounced",
        "opened",
        "clicked",
      ],
      reward_status: ["available", "used", "expired"],
      reward_type: ["discount", "free_activity", "vip_upgrade"],
      segment_type: [
        "past_travelers",
        "leads",
        "tag",
        "all_subscribed",
        "custom",
      ],
      trip_status: ["draft", "open", "closed", "completed"],
      visa_document_type: [
        "passport",
        "photo",
        "employment",
        "flight",
        "hotel",
        "other",
      ],
      visa_status: [
        "draft",
        "submitted",
        "documents_received",
        "in_review",
        "approved",
        "rejected",
        "completed",
        "awaiting_documents",
        "submitted_to_embassy",
      ],
    },
  },
} as const
