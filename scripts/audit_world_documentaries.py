#!/usr/bin/env python3
import os
import audit_world_kids as audit
audit.PLAYLIST = os.environ['DOCUMENTARY_PLAYLIST']
audit.main()
