Pod::Spec.new do |s|
  s.name           = 'AppleIntelligence'
  s.version        = '1.0.0'
  s.summary        = 'Pantrio bridge for Apple Foundation Models'
  s.description    = 'Checks and uses the on-device model that powers Apple Intelligence.'
  s.license        = { :type => 'MIT' }
  s.author         = 'Pantrio'
  s.homepage       = 'https://example.invalid'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
